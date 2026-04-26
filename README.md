# Domain Health — Email Deliverability & DMARC Monitoring

Self-hosted stack for monitoring email sending domain health, DMARC compliance, and campaign deliverability. Deployed on a GCP VM.

## Architecture

```
                  Gmail DMARC Inbox
                        │
                        ▼
               ┌─────────────────┐
               │   parsedmarc    │  Parses DMARC XML reports
               │   (Docker)      │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐
               │   InfluxDB 2.7  │  Time-series storage
               │   (Docker)      │◄──────────────────────┐
               └────────┬────────┘                       │
                        │                                │
          ┌─────────────┼─────────────┐                  │
          ▼             ▼             ▼                  │
    ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
    │ Grafana  │  │ Dashboard│  │  Deliverability  │────┘
    │ (Docker) │  │ (Node.js)│  │  Monitor (Python)│
    └──────────┘  └──────────┘  └──────────────────┘
       :3000         :8787          systemd daemon
```

## Components

| Component | Directory | Tech | Purpose |
|-----------|-----------|------|---------|
| **parsedmarc** | `parsedmarc-stack/` | Docker (Python 3.12 + Grafana + Caddy) | Watches Gmail DMARC mailbox, parses XML reports, writes to InfluxDB |
| **Deliverability Monitor** | `deliverability_monitor/` | Python systemd daemon | Scheduled checks: DNS, blacklists, Smartlead health, warmup, bounce, Google Postmaster |
| **Dashboard** | `dmarc-dashboard/` | React 19 + Express 5 | Auth-protected dashboard reading InfluxDB + Smartlead API |

## Quick Start

### Prerequisites

- GCP VM (or any Linux server) with Docker, Node.js 20+, Python 3.10+
- Gmail account with IMAP enabled and an App Password
- Smartlead API key
- Firebase project for Google sign-in

### 1. Configure Environment

Copy and fill in the `.env` files:

```bash
# Root .env (shared secrets)
cp .env.example .env

# parsedmarc-stack uses root .env via env_file
# dmarc-dashboard needs its own .env
cp dmarc-dashboard/.env.example dmarc-dashboard/.env
```

Key variables:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `INFLUXDB_TOKEN` | All components | Shared InfluxDB admin token |
| `SMARTLEAD_API_KEY` | Monitor + Dashboard | Smartlead API access |
| `DMARC_MAILBOX_USER` | parsedmarc | Gmail address (e.g. `DMARC@pintel.ai`) |
| `DMARC_MAILBOX_APP_PASSWORD` | parsedmarc | Gmail App Password (16 chars, no spaces) |
| `FIREBASE_PROJECT_ID` | Dashboard | Firebase Auth project ID |
| `ALERT_WEBHOOK_URL` | Monitor | n8n webhook for alerts |

### 2. Start parsedmarc Stack

```bash
cd parsedmarc-stack
docker compose up -d --build
docker compose logs -f parsedmarc    # verify DMARC parsing
```

Services started: parsedmarc, InfluxDB (:8086), Grafana (:3000), Caddy (reverse proxy).

### 3. Start Deliverability Monitor

```bash
cd deliverability_monitor
pip3 install -r requirements.txt

# Smoke test — run all modules once
python3 scheduler.py --once

# Production — install as systemd service
sudo systemctl enable deliverability_monitor
sudo systemctl start deliverability_monitor
```

### 4. Start Dashboard

```bash
cd dmarc-dashboard
npm install
npm run build
npm run start:api    # Serves API + frontend on :8787
```

For development:

```bash
npm run dev           # Vite dev server at :5173
npm run dev:api       # Express API at :8787 (separate terminal)
```

### 5. Automated Setup

Or use the setup script for full deployment:

```bash
chmod +x setup.sh
./setup.sh
```

## Monitoring Modules

The deliverability monitor runs 10 modules on scheduled intervals:

| Module | Check | Interval | Alerts on |
|--------|-------|----------|-----------|
| `rbl_monitor` | IP/domain blacklist status | 12h | Blacklist detected |
| `dmarc_validator` | DMARC/SPF/DKIM DNS records | 24h | DNS validation failed |
| `spf_ip_validator` | SPF record covers all IPs | 24h | Unauthorized IP |
| `smartlead_health` | Inbox placement rates | 6h | High spam rate |
| `warmup_stats` | Mailbox warmup health | 12h | High warmup spam |
| `reconnect_monitor` | SMTP/IMAP connectivity | 6h | Reconnect required |
| `campaign_bounce` | Campaign bounce rates | 6h | High bounce rate |
| `postmaster_monitor` | Google Postmaster metrics | 24h | Poor reputation |
| `domain_discovery` | Auto-discover domains from Smartlead | 6h | — |
| `daily_digest` | Summary of all checks | Daily 08:00 UTC | — |

## Dashboard Pages

| Page | Data Source | Features |
|------|-------------|----------|
| **Overview** | InfluxDB | DMARC domain stats, pass-rate alerts, ↻ force-refresh button |
| **Replies** | Smartlead API | Reply categories, daily positive trends, per-campaign sentiment |
| **Mailboxes** | Smartlead API | Health table, domain/provider charts, disconnected account visibility |
| **Campaigns** | Smartlead API | Funnel chart, daily activity, status filter, search, sortable table |
| **Domains** | InfluxDB + Smartlead | 11-column table with SPF/DKIM/DMARC stats, historical charts, ↻ force-refresh button |
| **Sequences** | Smartlead API | Per-campaign sequence performance |

## InfluxDB Buckets

Two buckets:

- **`dmarc`** — Written directly by parsedmarc via its native `[influxdb2]` output (measurement: `dmarc_aggregate`). No intermediate file or sidecar — parsedmarc writes synchronously to InfluxDB per report.
- **`deliverability`** — Written by deliverability monitor (8 measurements)

## Alerting

Modules send alerts via POST to `ALERT_WEBHOOK_URL` (n8n webhook). Alert types:
`blacklist_detected`, `dns_validation_failed`, `high_spam_rate`, `warmup_high_spam`, `mailbox_reconnect_required`, `high_campaign_bounce_rate`, `postmaster_poor_reputation`, `daily_digest`

## Ports

| Port | Service |
|------|---------|
| 3000 | Grafana |
| 8086 | InfluxDB |
| 8787 | Dashboard (API + frontend) |
| 80/443 | Caddy (reverse proxy) |
