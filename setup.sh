#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — two-phase deployment script
#
# LOCAL usage (from your machine or Cloud Shell):
#   bash setup.sh --provision
#
#   Reads GCP project, creates VM, copies all project files, then SSHes in
#   and runs the VM setup phase automatically.
#
#   Optional env overrides before running:
#     VM_NAME=my-vm VM_ZONE=us-east1-b bash setup.sh --provision
#
# VM usage (runs automatically via --provision, or manually on the VM):
#   sudo bash setup.sh
#
#   Requires: /opt/domain_health/.env configured first.
# ─────────────────────────────────────────────────────────────────────────────

PROVISION_MODE=false
[[ "${1:-}" == "--provision" ]] && PROVISION_MODE=true

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — LOCAL: provision VM, copy files, trigger remote setup
# ─────────────────────────────────────────────────────────────────────────────
if $PROVISION_MODE; then

  # Resolve the directory this script lives in (works from any CWD)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  # ── Require .env to exist locally before we do anything ──────────────────
  if [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
    echo "ERROR: .env not found at ${SCRIPT_DIR}/.env"
    echo "Copy and configure it first:"
    echo "  cp ${SCRIPT_DIR}/.env.example ${SCRIPT_DIR}/.env"
    echo "  nano ${SCRIPT_DIR}/.env"
    exit 1
  fi

  # ── Read GCP project ID ───────────────────────────────────────────────────
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null | tr -d '[:space:]')
  if [[ -z "$PROJECT_ID" ]]; then
    echo "ERROR: No active GCP project."
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
  fi
  echo "GCP project : $PROJECT_ID"

  # ── VM config (override via env vars) ────────────────────────────────────
  VM_NAME="${VM_NAME:-domain-health}"
  VM_ZONE="${VM_ZONE:-us-central1-a}"
  VM_MACHINE_TYPE="${VM_MACHINE_TYPE:-e2-standard-2}"
  VM_DISK_SIZE="${VM_DISK_SIZE:-50GB}"

  echo "VM name     : $VM_NAME"
  echo "Zone        : $VM_ZONE"
  echo "Machine     : $VM_MACHINE_TYPE  /  disk $VM_DISK_SIZE"
  echo

  # ── Create VM (skip if it already exists) ────────────────────────────────
  if gcloud compute instances describe "$VM_NAME" \
       --zone="$VM_ZONE" --project="$PROJECT_ID" \
       --format="get(status)" >/dev/null 2>&1; then
    echo "=== VM '$VM_NAME' already exists — skipping creation ==="
  else
    echo "=== Creating VM ==="
    gcloud compute instances create "$VM_NAME" \
      --project="$PROJECT_ID" \
      --zone="$VM_ZONE" \
      --machine-type="$VM_MACHINE_TYPE" \
      --image-family=ubuntu-2204-lts \
      --image-project=ubuntu-os-cloud \
      --boot-disk-size="$VM_DISK_SIZE" \
      --boot-disk-type=pd-ssd \
      --tags=http-server,https-server \
      --scopes=cloud-platform \
      --metadata=enable-oslogin=TRUE

    echo "Waiting 30 s for VM to boot..."
    sleep 30
  fi

  # ── Fetch external IP ─────────────────────────────────────────────────────
  VM_IP=$(gcloud compute instances describe "$VM_NAME" \
    --zone="$VM_ZONE" \
    --project="$PROJECT_ID" \
    --format="get(networkInterfaces[0].accessConfigs[0].natIP)")
  echo "External IP : $VM_IP"

  # ── Firewall rule (idempotent) ────────────────────────────────────────────
  echo "=== Ensuring firewall rule ==="
  gcloud compute firewall-rules create allow-dmarc-stack-ports \
    --project="$PROJECT_ID" \
    --allow tcp:3000,tcp:8086,tcp:8787 \
    --target-tags=http-server,https-server \
    --description="Grafana:3000 InfluxDB:8086 Dashboard:8787" 2>/dev/null \
    && echo "Firewall rule created." \
    || echo "Firewall rule already exists — skipping."

  # ── Wait for SSH to become available ─────────────────────────────────────
  echo "=== Waiting for SSH ==="
  for i in $(seq 1 12); do
    if gcloud compute ssh "$VM_NAME" \
         --zone="$VM_ZONE" --project="$PROJECT_ID" \
         --ssh-flag="-o ConnectTimeout=5" \
         --command="echo ssh-ready" 2>/dev/null; then
      echo "SSH is up."
      break
    fi
    echo "  Attempt $i/12 — retrying in 10 s..."
    sleep 10
    if [[ $i -eq 12 ]]; then
      echo "ERROR: SSH did not become available after 2 min."
      exit 1
    fi
  done

  # ── Pack project into a tarball (exclude build artifacts) ─────────────────
  echo "=== Packing project files ==="
  TMPTAR=$(mktemp /tmp/domain_health_XXXXXX.tar.gz)
  tar -czf "$TMPTAR" \
    --exclude="./.git" \
    --exclude="./node_modules" \
    --exclude="./dmarc-dashboard/dist" \
    --exclude="./__pycache__" \
    --exclude="./*.tar.gz" \
    --exclude="./.env.local" \
    -C "$SCRIPT_DIR" .
  echo "Archive: $TMPTAR ($(du -sh "$TMPTAR" | cut -f1))"

  # ── Upload tarball ────────────────────────────────────────────────────────
  echo "=== Uploading to VM ==="
  gcloud compute scp "$TMPTAR" \
    "${VM_NAME}:/tmp/domain_health.tar.gz" \
    --zone="$VM_ZONE" --project="$PROJECT_ID"
  rm -f "$TMPTAR"

  # ── Extract on VM ─────────────────────────────────────────────────────────
  echo "=== Extracting files on VM ==="
  gcloud compute ssh "$VM_NAME" \
    --zone="$VM_ZONE" --project="$PROJECT_ID" \
    --command="
      sudo mkdir -p /opt/domain_health
      sudo tar -xzf /tmp/domain_health.tar.gz -C /opt/domain_health
      sudo rm -f /tmp/domain_health.tar.gz
      sudo chown -R root:root /opt/domain_health
      echo 'Extraction complete.'
    "

  # ── Run VM setup remotely ─────────────────────────────────────────────────
  echo "=== Running setup on VM ==="
  gcloud compute ssh "$VM_NAME" \
    --zone="$VM_ZONE" --project="$PROJECT_ID" \
    --command="sudo bash /opt/domain_health/setup.sh"

  echo
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  Deployment complete                                 ║"
  echo "╠══════════════════════════════════════════════════════╣"
  printf "║  VM          %-38s ║\n" "$VM_NAME  ($VM_IP)"
  printf "║  Grafana     %-38s ║\n" "http://$VM_IP:3000"
  printf "║  InfluxDB    %-38s ║\n" "http://$VM_IP:8086"
  printf "║  Dashboard   %-38s ║\n" "http://$VM_IP:8787"
  echo "╚══════════════════════════════════════════════════════╝"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — VM: install everything and start services
# (runs automatically at the end of --provision, or manually on the VM)
# ─────────────────────────────────────────────────────────────────────────────

############################
# Load configuration from global .env
############################
VM_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${VM_REPO_ROOT}/.env" ]]; then
  echo "Global .env file not found at ${VM_REPO_ROOT}/.env"
  echo "Copy .env.example to .env and configure it first:"
  echo "  cp ${VM_REPO_ROOT}/.env.example ${VM_REPO_ROOT}/.env"
  echo "  nano ${VM_REPO_ROOT}/.env"
  exit 1
fi

set -a
source "${VM_REPO_ROOT}/.env"
set +a

# Validate required variables
if [[ -z "${VM_HOST_IP:-}" ]]; then
  echo "VM_HOST_IP is not set in .env"
  exit 1
fi

if [[ -z "${INFLUXDB_TOKEN:-}" ]] || [[ "${INFLUXDB_TOKEN}" == change_me* ]]; then
  echo "INFLUXDB_TOKEN is not configured in .env (still has placeholder value)"
  exit 1
fi

if [[ -z "${SMARTLEAD_API_KEY:-}" ]] || [[ "${SMARTLEAD_API_KEY}" == change_me* ]]; then
  echo "SMARTLEAD_API_KEY is not configured in .env (still has placeholder value)"
  exit 1
fi

if [[ -z "${DMARC_MAILBOX_APP_PASSWORD:-}" ]] || [[ "${DMARC_MAILBOX_APP_PASSWORD}" == change_me* ]]; then
  echo "DMARC_MAILBOX_APP_PASSWORD is not configured in .env (still has placeholder value)"
  exit 1
fi

if [[ -z "${FIREBASE_PROJECT_ID:-}" ]] || [[ "${FIREBASE_PROJECT_ID}" == change_me* ]]; then
  echo "FIREBASE_PROJECT_ID is not configured in .env (still has placeholder value)"
  exit 1
fi

############################
# Basic checks
############################
if [[ ! -d "${VM_REPO_ROOT}" ]]; then
  echo "Repo root not found: ${VM_REPO_ROOT}"
  echo "Copy project first, then rerun."
  exit 1
fi

echo "=== Installing system packages ==="
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release git python3 python3-pip python3-venv jq unzip

echo "=== Installing Docker + Docker Compose plugin ==="
install -m 0755 -d /etc/apt/keyrings
OS_ID=$(. /etc/os-release && echo "$ID")
curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${OS_ID} \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker

echo "=== Installing Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "=== Opening firewall ports (3000/8086/8787) ==="
if command -v gcloud >/dev/null 2>&1; then
  gcloud compute firewall-rules create allow-dmarc-stack-ports \
    --allow tcp:3000,tcp:8086,tcp:8787 \
    --target-tags=http-server,https-server \
    --description="Allow Grafana, InfluxDB and Dashboard ports" || true
else
  echo "gcloud CLI not found on VM; create firewall rules from GCP console."
fi

echo "=== Configuring parsedmarc-stack ==="
cd "${VM_REPO_ROOT}/parsedmarc-stack"

cat <<EOF > .env
# ── DMARC Mailbox (IMAP + app password) ─────────────────────────────────────
DMARC_MAILBOX_USER=${DMARC_MAILBOX_USER}
DMARC_IMAP_HOST=${DMARC_IMAP_HOST}
DMARC_IMAP_PORT=${DMARC_IMAP_PORT}
DMARC_MAILBOX_APP_PASSWORD=${DMARC_MAILBOX_APP_PASSWORD}

# ── InfluxDB ───────────────────────────────────────────────────────────────────
INFLUXDB_ADMIN_USER=${INFLUXDB_ADMIN_USER}
INFLUXDB_ADMIN_PASSWORD=${INFLUXDB_ADMIN_PASSWORD}
INFLUXDB_ORG=${INFLUXDB_ORG}
INFLUXDB_TOKEN=${INFLUXDB_TOKEN}
INFLUXDB_DMARC_BUCKET=${INFLUXDB_DMARC_BUCKET}

# ── Grafana ────────────────────────────────────────────────────────────────────
GRAFANA_ADMIN_USER=${GRAFANA_ADMIN_USER}
GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}
EOF

docker compose up -d --build parsedmarc influxdb grafana

echo "=== Configuring deliverability_monitor ==="
cd "${VM_REPO_ROOT}/deliverability_monitor"

cat <<EOF > .env
# ── Smartlead ──────────────────────────────────────────────
SMARTLEAD_API_KEY=${SMARTLEAD_API_KEY}

# ── InfluxDB ───────────────────────────────────────────────
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=${INFLUXDB_TOKEN}
INFLUXDB_ORG=${INFLUXDB_ORG}
INFLUXDB_BUCKET=deliverability

# ── Google Postmaster Tools ────────────────────────────────
POSTMASTER_CREDENTIALS_PATH=${POSTMASTER_CREDENTIALS_PATH:-}

# ── Alerting (n8n webhook) ─────────────────────────────────
ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL}
ALERT_THRESHOLD_SPAM_PCT=${ALERT_THRESHOLD_SPAM_PCT}
ALERT_THRESHOLD_BLACKLIST=${ALERT_THRESHOLD_BLACKLIST}
ALERT_THRESHOLD_DMARC_SCORE=${ALERT_THRESHOLD_DMARC_SCORE}
DIGEST_HOUR_UTC=${DIGEST_HOUR_UTC}

# ── Smartlead tuning ───────────────────────────────────────
WARMUP_BATCH_DELAY_SECS=${WARMUP_BATCH_DELAY_SECS}
CAMPAIGN_BOUNCE_THRESHOLD=${CAMPAIGN_BOUNCE_THRESHOLD}

# ── Schedule intervals (hours) ─────────────────────────────
RBL_CHECK_INTERVAL_HOURS=${RBL_CHECK_INTERVAL_HOURS}
DMARC_CHECK_INTERVAL_HOURS=${DMARC_CHECK_INTERVAL_HOURS}
SMARTLEAD_POLL_INTERVAL_HOURS=${SMARTLEAD_POLL_INTERVAL_HOURS}
WARMUP_INTERVAL_HOURS=${WARMUP_INTERVAL_HOURS}
RECONNECT_INTERVAL_HOURS=${RECONNECT_INTERVAL_HOURS}
CAMPAIGN_BOUNCE_INTERVAL_HOURS=${CAMPAIGN_BOUNCE_INTERVAL_HOURS}
POSTMASTER_INTERVAL_HOURS=${POSTMASTER_INTERVAL_HOURS}
SPF_IP_INTERVAL_HOURS=${SPF_IP_INTERVAL_HOURS}
EOF

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cat <<EOF > /etc/systemd/system/deliverability_monitor.service
[Unit]
Description=Pintel Deliverability Monitor
After=network-online.target influxdb.service
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${VM_REPO_ROOT}/deliverability_monitor
Environment="PYTHONPATH=${VM_REPO_ROOT}/deliverability_monitor"
ExecStart=${VM_REPO_ROOT}/deliverability_monitor/.venv/bin/python ${VM_REPO_ROOT}/deliverability_monitor/scheduler.py
Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=deliverability-monitor

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now deliverability_monitor

echo "=== Configuring dmarc-dashboard ==="
cd "${VM_REPO_ROOT}/dmarc-dashboard"

cat <<EOF > .env
API_PORT=${API_PORT}

INFLUX_URL=http://localhost:8086
INFLUX_ORG=${INFLUXDB_ORG}
INFLUX_BUCKET=${INFLUXDB_DMARC_BUCKET}
INFLUX_TOKEN=${INFLUXDB_TOKEN}

FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID}
EOF

npm ci
npm run build

cat <<EOF > /etc/systemd/system/dmarc_dashboard_api.service
[Unit]
Description=DMARC Dashboard API + UI
After=network.target

[Service]
Type=simple
WorkingDirectory=${VM_REPO_ROOT}/dmarc-dashboard
ExecStart=/usr/bin/npm run start:api
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now dmarc_dashboard_api

echo "=== Final checks ==="
docker compose -f "${VM_REPO_ROOT}/parsedmarc-stack/docker-compose.yml" ps
systemctl --no-pager --full status deliverability_monitor || true
systemctl --no-pager --full status dmarc_dashboard_api || true

echo
echo "Setup complete."
echo "Access URLs (IP-based):"
echo "  http://${VM_HOST_IP}:3000  (Grafana)"
echo "  http://${VM_HOST_IP}:8086  (InfluxDB API)"
echo "  http://${VM_HOST_IP}:8787  (Protected React dashboard)"
