#!/bin/bash
# Redeploy everything from the latest git state on an already-provisioned VM.
# Run on the VM:
#   cd ~/domain_health && bash scripts/redeploy.sh
#
# What it does:
#   1. git pull
#   2. Rebuild + restart parsedmarc Docker stack
#   3. Reinstall Python deps + restart deliverability_monitor
#   4. Rebuild React bundle + restart dmarc_dashboard_api
#
# Data is NOT touched. Use scripts/reprocess-dmarc.sh to wipe + backfill InfluxDB.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
echo "Repo root: $REPO"

# ── Step 1: Pull latest code ──────────────────────────────────────────────────
echo ""
echo "=== [1/4] git pull ==="
cd "$REPO"
git pull
echo "Code up to date."

# ── Step 2: parsedmarc Docker stack ──────────────────────────────────────────
echo ""
echo "=== [2/4] Rebuild parsedmarc Docker stack ==="
cd "$REPO/parsedmarc-stack"
docker compose pull --quiet influxdb caddy 2>/dev/null || true
docker compose build --no-cache parsedmarc
docker compose up -d --remove-orphans
docker compose ps
echo "Docker stack up."

# ── Step 3: deliverability_monitor ───────────────────────────────────────────
echo ""
echo "=== [3/4] Reinstall Python deps + restart deliverability_monitor ==="
cd "$REPO/deliverability_monitor"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
sudo systemctl restart deliverability_monitor
sudo systemctl --no-pager status deliverability_monitor
echo "deliverability_monitor restarted."

# ── Step 4: dmarc-dashboard ───────────────────────────────────────────────────
echo ""
echo "=== [4/4] Rebuild React bundle + restart dmarc_dashboard_api ==="
cd "$REPO/dmarc-dashboard"
npm ci --prefer-offline
npm run build
sudo systemctl restart dmarc_dashboard_api
sudo systemctl --no-pager status dmarc_dashboard_api
echo "dmarc_dashboard_api restarted."

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Redeploy complete ==="
echo ""
echo "Service status:"
docker compose -f "$REPO/parsedmarc-stack/docker-compose.yml" ps
sudo systemctl is-active deliverability_monitor && echo "deliverability_monitor: active" || echo "deliverability_monitor: FAILED"
sudo systemctl is-active dmarc_dashboard_api    && echo "dmarc_dashboard_api:    active" || echo "dmarc_dashboard_api: FAILED"
echo ""
echo "Logs:"
echo "  docker logs -f parsedmarc"
echo "  sudo journalctl -u deliverability_monitor -f"
echo "  sudo journalctl -u dmarc_dashboard_api -f"
