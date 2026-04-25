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
1. `parsedmarc` daemon watches `DMARC@pintel.ai` Gmail inbox → parses DMARC XML reports → writes `aggregate.json` to shared Docker volume (`parsedmarc_data`) → `influx_writer` service reads `/data/aggregate.json` every 30s and writes `dmarc_aggregate` measurement to InfluxDB `dmarc` bucket
2. `deliverability_monitor` scheduler runs 10 modules on 6–24h intervals → writes 8 measurements to InfluxDB `deliverability` bucket
3. `dmarc-dashboard` Express server (with 90-minute server-side cache) queries InfluxDB via Flux + Smartlead API → serves React SPA on port 8787 with client-side 90-minute cache

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
- Firebase Google Sign-In (restricted to `@pintel.ai` via `hd` param hint)
- Server verifies Firebase ID token via Firebase Admin `verifyIdToken` + email domain check
- All `/api/metrics/*` and `/api/smartlead/*` routes protected by `authMiddleware` + `rateLimitMiddleware` (60 req/min per user, 429 + `Retry-After` on breach)
- InfluxDB token never exposed to the browser

### dmarc-dashboard Pages
- **Mailboxes** — Real-time mailbox status with clickable filter pills (active/idle/disconnected); "By Sending Domain" card full width
- **Domains** — Merges Smartlead domain health data with InfluxDB DMARC stats in an 11-column searchable/sortable table; includes SPF validation status, DKIM checks, DMARC alignment, and historical charts (DMARC pass rate, domain reputation trend)
- **Campaigns** — Campaign metrics from Smartlead; deliverability trends

### dmarc-dashboard Caching Architecture
- **Client-side cache** (`src/api/cache.js`) — 90-minute TTL in-memory cache with inflight request deduplication; used by all `src/api/smartlead.js` and `src/api/influx.js` functions
- **Server-side cache** (`server/smartlead.js`) — 90-minute in-process cache on Express for all Smartlead GET endpoints (prevents rate-limiting 500 errors on double-clicks or page revisits)
- Cache hit detection via headers and metrics API to minimize InfluxDB/Smartlead API calls

### Alerting
Modules call `alerter.post_alert(event, subject, detail)` → POST JSON to `ALERT_WEBHOOK_URL` (n8n webhook). Alert events: `blacklist_detected`, `dns_validation_failed`, `high_spam_rate`, `warmup_high_spam`, `mailbox_reconnect_required`, `high_campaign_bounce_rate`, `postmaster_poor_reputation`, `daily_digest`.

## Configuration

All secrets live in a single `.env` at the project root. Key variables:

### InfluxDB (canonical prefix — used by all three components)
- `INFLUXDB_URL` — e.g. `http://localhost:8086` (deliverability_monitor + dashboard)
- `INFLUXDB_TOKEN` — shared token (must match across all components)
- `INFLUXDB_ORG` — InfluxDB org name (default `pintel`)
- `INFLUXDB_DMARC_BUCKET` — bucket for DMARC data (default `dmarc`)
- `INFLUXDB_ADMIN_USER` / `INFLUXDB_ADMIN_PASSWORD` — docker-compose init only

> `server/index.js` accepts both `INFLUXDB_*` (preferred) and legacy `INFLUX_*` prefixes.

### Other
- `SMARTLEAD_API_KEY` — used by `domain_discovery`, `smartlead_health`, `warmup_stats`, `reconnect_monitor`, `campaign_bounce`
- `DMARC_MAILBOX_USER` / `DMARC_MAILBOX_APP_PASSWORD` — Gmail IMAP for parsedmarc
- `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_APP_ID` — Firebase client (build-time; validated at startup)
- `FIREBASE_PROJECT_ID` — Firebase Admin (server-side token verification)
- `ALLOWED_DOMAIN` — email domain allowed to log in (default `pintel.ai`)
- `ALERT_WEBHOOK_URL` — n8n webhook endpoint
- `POSTMASTER_CREDENTIALS_PATH` — Google service account JSON (optional; module skips if missing)
- `DIGEST_HOUR_UTC` — hour for daily digest (default 8)

### Tunable runtime env vars
| Var | Default | Where used |
|-----|---------|-----------|
| `WARMUP_BATCH_DELAY_SECS` | `0.3` | warmup_stats inter-request delay |
| `WARMUP_MAX_WORKERS` | `10` | warmup_stats thread pool size |
| `CAMPAIGN_BOUNCE_DELAY_SECS` | `0.2` | campaign_bounce inter-request delay |
| `CAMPAIGN_BOUNCE_THRESHOLD` | `3.0` | bounce % alert threshold |
| `PARSEDMARC_MAILBOX_BATCH_SIZE` | `10` | parsedmarc IMAP batch size |

## Deployment

`setup.sh` at project root handles full first-time deployment: validates `.env`, installs Docker/Node/Python, starts Docker stack, installs Python deps + systemd service, builds React app + installs systemd service, opens firewall ports (3000, 8086, 8787).

For subsequent deploys (code changes only):
```bash
cd ~/domain_health && bash scripts/redeploy.sh
```
Rebuilds parsedmarc Docker image, restarts all containers, reinstalls Python venv, rebuilds React bundle, restarts both systemd services. Data volumes are untouched.

## Development Notes

- Local dev: run `npm run dev` (Vite at :5173) + `npm run dev:api` (API at :8787); Vite proxies `/api` to :8787
- `deliverability_monitor` accesses InfluxDB inside Docker via the bridge network (`localhost:8086` from the host systemd service)
- `warmup_stats` has a 0.3s inter-request delay across 164 mailboxes (~50s per run); tunable via env var
- Postmaster Tools module is optional — silently skips if credentials file not found
- `parsedmarc_data` Docker volume (`/data` inside container) is shared between `parsedmarc` and `influx_writer` services; `aggregate.json` is written by parsedmarc and read by influx_writer every 30s
- E2E tests in `dmarc-dashboard/e2e/` cover login, campaigns, mailboxes, and dashboard UX via Playwright

<!-- claude --resume 217c241f-f162-4490-aad3-656c35cccf26   -->