# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A self-hosted email deliverability and DMARC monitoring stack deployed on a GCP VM. Three components share a single InfluxDB instance and a root-level `.env` file.

## Components

| Component | Tech | Purpose |
|-----------|------|---------|
| `parsedmarc-stack/` | Docker (Python + Grafana + Caddy) | Watches Gmail DMARC mailbox, parses XML reports, writes to InfluxDB |
| `deliverability_monitor/` | Python systemd daemon | Scheduled checks: DNS, blacklists, Smartlead health, warmup, bounce, postmaster |
| `dmarc-dashboard/` | React 19 + Express 5 | Auth-protected dashboard that reads InfluxDB DMARC data |

## Commands

### parsedmarc-stack (Docker)
```bash
cd parsedmarc-stack
docker compose build
docker compose up -d
docker compose logs -f parsedmarc
```

### deliverability_monitor (Python)
```bash
cd deliverability_monitor
pip3 install -r requirements.txt

# Run a single module manually
python3 scheduler.py --module discovery
python3 scheduler.py --module dmarc
python3 scheduler.py --module rbl

# Run all modules once and exit (smoke test)
python3 scheduler.py --once

# Long-running daemon
python3 scheduler.py

# Production service
sudo systemctl restart deliverability_monitor
sudo journalctl -u deliverability_monitor -f
```

### dmarc-dashboard (Node.js)
```bash
cd dmarc-dashboard
npm install
npm run lint          # ESLint
npm run dev           # Vite dev server at :5173
npm run dev:api       # Express API at :8787 (separate terminal)
npm run build         # Production bundle → dist/
npm run start:api     # Prod: serve API + built frontend
```

## Architecture

### Data Flow
1. `parsedmarc` daemon watches `DMARC@pintel.ai` Gmail inbox → parses DMARC XML reports → writes `dmarc_aggregate` measurement to InfluxDB `dmarc` bucket
2. `deliverability_monitor` scheduler runs 10 modules on 6–24h intervals → writes 8 measurements to InfluxDB `deliverability` bucket
3. `dmarc-dashboard` Express server queries InfluxDB via Flux → serves React SPA on port 8787

### deliverability_monitor Scheduler (`scheduler.py`)
- On startup: calls `domain_discovery.refresh()` to pull domains/IPs from Smartlead API
- Registers all 10 modules with `schedule` library at configured intervals
- Each module runs in `_run_safe()` wrapper — failures are logged but don't crash the daemon
- Domain list auto-populated from Smartlead; static fallback in `config/settings.py`

### Module → InfluxDB Measurement Mapping
| Module | Measurement | Interval |
|--------|-------------|----------|
| `rbl_monitor` | `rbl_check` | 12h |
| `dmarc_validator` | `dmarc_dns_check` | 24h |
| `smartlead_health` | `smartlead_health` | 6h |
| `warmup_stats` | `warmup_stats` | 12h |
| `reconnect_monitor` | `mailbox_status` | 6h |
| `campaign_bounce` | `campaign_bounce` | 6h |
| `postmaster_monitor` | `postmaster_metrics` | 24h |
| `spf_ip_validator` | `spf_ip_validation` | 24h |

### dmarc-dashboard Auth Flow
- POST `/api/auth/login` validates against `API_AUTH_USER`/`API_AUTH_PASSWORD` env vars
- Issues JWT signed with `API_JWT_SECRET`, stored in httpOnly `dmarc_auth` cookie (12h)
- All `/api/metrics/*` routes protected by JWT middleware
- InfluxDB token never exposed to the browser

### Alerting
Modules call `alerter.post_alert(event, subject, detail)` → POST JSON to `ALERT_WEBHOOK_URL` (n8n webhook). Alert events: `blacklist_detected`, `dns_validation_failed`, `high_spam_rate`, `warmup_high_spam`, `mailbox_reconnect_required`, `high_campaign_bounce_rate`, `postmaster_poor_reputation`, `daily_digest`.

## Configuration

All secrets live in a single `.env` at the project root. Key variables:
- `INFLUXDB_TOKEN` — shared across all 3 components (must match)
- `SMARTLEAD_API_KEY` — used by `domain_discovery`, `smartlead_health`, `warmup_stats`, `reconnect_monitor`, `campaign_bounce`
- `DMARC_MAILBOX_USER` / `DMARC_MAILBOX_APP_PASSWORD` — Gmail IMAP for parsedmarc
- `API_AUTH_USER` / `API_AUTH_PASSWORD` / `API_JWT_SECRET` — dashboard auth
- `ALERT_WEBHOOK_URL` — n8n webhook endpoint
- `POSTMASTER_CREDENTIALS_PATH` — Google service account JSON (optional; module skips if missing)
- `DIGEST_HOUR_UTC` — hour for daily digest (default 8)

## Deployment

`setup.sh` at project root handles full deployment: validates `.env`, installs Docker/Node/Python, starts Docker stack, installs Python deps + systemd service, builds React app + installs systemd service, opens firewall ports (3000, 8086, 8787).

## Development Notes

- Local dev: run `npm run dev` (Vite at :5173) + `npm run dev:api` (API at :8787); Vite proxies `/api` to :8787
- `deliverability_monitor` accesses InfluxDB inside Docker via the bridge network (`localhost:8086` from the host systemd service)
- `warmup_stats` has a 0.3s inter-request delay across 164 mailboxes (~50s per run); tunable via env var
- Postmaster Tools module is optional — silently skips if credentials file not found

<!-- claude --resume 217c241f-f162-4490-aad3-656c35cccf26   -->