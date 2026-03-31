# Global Setup Guide (GCP VM)

This guide deploys all 3 projects together on one GCP VM:

- `parsedmarc-stack` (Docker: parsedmarc, InfluxDB, Grafana, Caddy)
- `deliverability_monitor` (Python service via systemd)
- `dmarc-dashboard` (protected login UI + API via systemd)

---

## 1) Prepare VM and files

<!-- @import "[TOC]" {cmd="toc" depthFrom=1 depthTo=6 orderedList=false} -->

1. SSH into your VM.
2. Copy project folder to:
   - `/opt/domain_health`
3. Make sure DMARC mailbox has:
   - IMAP enabled
   - 2FA enabled
   - a generated Gmail App Password

---

## 2) No domain needed

This setup works directly with your VM public IP.

You will access:

- Grafana: `http://<VM_PUBLIC_IP>:3000`
- InfluxDB: `http://<VM_PUBLIC_IP>:8086`
- Dashboard: `http://<VM_PUBLIC_IP>:8787`

---

## 3) Configure global .env

Copy the global `.env.example` to `.env` and fill in all values:

```bash
cd /opt/domain_health
cp .env.example .env
nano .env
```

Edit these values in the global `.env`:

- `VM_HOST_IP` - Your VM's public IP
- All `CHANGE_ME_*` secrets (passwords, tokens)
- `SMARTLEAD_API_KEY`
- `ALERT_WEBHOOK_URL` (optional)
- `DMARC_MAILBOX_USER` and `DMARC_MAILBOX_APP_PASSWORD`

This single `.env` file configures all three components.

---

## 4) Run global setup

```bash
cd /opt/domain_health
chmod +x setup.sh
sudo ./setup.sh
```

What this script does:

- installs Docker, Docker Compose, Node.js, Python dependencies
- reads configuration from the global `.env`
- starts `parsedmarc-stack` containers (parsedmarc + influxdb + grafana)
- enables `deliverability_monitor` as systemd service
- builds and runs `dmarc-dashboard` API/UI as systemd service
- uses IP + ports directly (no domain or Caddy required)

---

## 5) Login behavior (protected)

- Dashboard login allows only the configured user:
  - `API_AUTH_USER` (default `authuser`)
  - `API_AUTH_PASSWORD`
- All dashboard API routes are protected by auth cookie + JWT.
- Frontend is served by backend (`dist`) and requires authenticated session for data.

---

## 6) Verify services

```bash
cd /opt/domain_health/parsedmarc-stack

docker compose ps
docker compose logs -f parsedmarc

systemctl status deliverability_monitor
systemctl status dmarc_dashboard_api
```

Open in browser:

- `http://<VM_PUBLIC_IP>:3000` (Grafana)
- `http://<VM_PUBLIC_IP>:8787` (login-protected dashboard)
- `http://<VM_PUBLIC_IP>:8086` (Influx API endpoint)

---

## 7) Common updates

### Update dashboard after code changes

```bash
cd /opt/domain_health/dmarc-dashboard
npm ci
npm run build
sudo systemctl restart dmarc_dashboard_api
```

### Update parsedmarc stack

```bash
cd /opt/domain_health/parsedmarc-stack
docker compose up -d --build
```

### Restart deliverability monitor

```bash
sudo systemctl restart deliverability_monitor
```
