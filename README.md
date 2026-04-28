# Domain Health - Email Deliverability & DMARC Monitoring

Self-hosted stack for monitoring email sending domain health, DMARC compliance, and campaign deliverability on a GCP VM.

## Architecture

```text
Gmail DMARC Inbox
       |
       v
parsedmarc hourly run (Docker) --> /data/aggregate.json
       |                         |
       |                         v
       |                  influx_writer sidecar
       |                         |
       v                         v
InfluxDB 2.7 <---------- deliverability_monitor (Python/systemd)
       |
       v
dmarc-dashboard (React + Express, :8787)
```

## Components

| Component | Directory | Tech | Purpose |
|-----------|-----------|------|---------|
| parsedmarc stack | `parsedmarc-stack/` | Docker: parsedmarc, influx_writer, InfluxDB, Caddy | Parses Gmail DMARC reports and writes DMARC points to InfluxDB via the sidecar |
| Deliverability Monitor | `deliverability_monitor/` | Python systemd daemon | Scheduled DNS, RBL, Smartlead, warmup, bounce, and Postmaster checks |
| Dashboard | `dmarc-dashboard/` | React 19 + Express 5 | Auth-protected dashboard reading InfluxDB and Smartlead API data |

Grafana has been removed to reduce memory pressure on the VM.

## Quick Start

### 1. Configure Environment

```bash
cp .env.example .env
```

Key variables:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `INFLUXDB_TOKEN` | All components | Shared InfluxDB admin token |
| `SMARTLEAD_API_KEY` | Monitor + Dashboard | Smartlead API access |
| `DMARC_MAILBOX_USER` | parsedmarc | Gmail address receiving DMARC reports |
| `DMARC_MAILBOX_APP_PASSWORD` | parsedmarc | Gmail app password |
| `PARSEDMARC_RUN_INTERVAL_SECONDS` | parsedmarc | One-shot mailbox processing interval, default `3600` |
| `FIREBASE_PROJECT_ID` | Dashboard | Firebase Auth project ID |
| `ALERT_WEBHOOK_URL` | Monitor | n8n webhook for alerts |

### 2. Start parsedmarc Stack

```bash
cd parsedmarc-stack
docker compose up -d --build
docker compose logs -f parsedmarc influx_writer
```

Services started: `parsedmarc`, `influx_writer`, `influxdb`, and `caddy`.

### 3. Start Deliverability Monitor

```bash
cd deliverability_monitor
pip3 install -r requirements.txt
python3 scheduler.py --once
sudo systemctl enable deliverability_monitor
sudo systemctl start deliverability_monitor
```

### 4. Start Dashboard

```bash
cd dmarc-dashboard
npm install
npm run build
npm run start:api
```

For development:

```bash
npm run dev
npm run dev:api
```

## Monitoring Modules

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
| `domain_discovery` | Auto-discover domains from Smartlead | 6h | None |
| `daily_digest` | Summary of all checks | Daily 08:00 UTC | None |

## Dashboard Pages

| Page | Data Source | Features |
|------|-------------|----------|
| Overview | InfluxDB | DMARC domain stats, pass-rate alerts, force-refresh |
| Replies | Smartlead API | Reply categories, daily positive trends, campaign sentiment |
| Mailboxes | Smartlead API | Mailbox health, domain/provider charts, disconnected accounts |
| Campaigns | Smartlead API | Funnel chart, daily activity, filters, sortable table |
| Domains | InfluxDB + Smartlead | SPF/DKIM/DMARC stats and historical charts |
| Sequences | Smartlead API | Per-campaign sequence performance |

## InfluxDB Buckets

- `dmarc`: written by the `influx_writer` sidecar from `/data/aggregate.json`
- `deliverability`: written by `deliverability_monitor`

## Ports

| Port | Service |
|------|---------|
| 8086 | InfluxDB |
| 8787 | Dashboard API + frontend |
| 80/443 | Caddy reverse proxy |
