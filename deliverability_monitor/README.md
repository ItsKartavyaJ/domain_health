# Deliverability Monitor

Self-hosted email deliverability monitoring stack for Pintel. Runs as a daemon on your GCP VM alongside parsedmarc + InfluxDB. Covers DNS validation, blacklist monitoring, Smartlead health metrics, Google Postmaster Tools reputation, and daily digest reporting — all writing to a shared InfluxDB bucket for the existing React dashboard.

---

## Architecture

```
scheduler.py (long-running daemon)
│
├── domain_discovery    ← auto-discovers all sending domains + IPs from Smartlead
│
<!-- @import "[TOC]" {cmd="toc" depthFrom=1 depthTo=6 orderedList=false} -->

├── DNS / Network
│   ├── dmarc_validator   ← SPF, DMARC, DKIM, MTA-STS, BIMI per domain
│   ├── rbl_monitor       ← DNSBL blacklist check (domains + IPs)
│   └── spf_ip_validator  ← confirms sending IPs are in SPF records
│
├── Smartlead API
│   ├── smartlead_health  ← inbox%, spam%, bounce% per domain + per mailbox
│   ├── warmup_stats      ← per-mailbox warmup health (replaces spam_audit.py)
│   ├── reconnect_monitor ← detects disconnected OAuth mailboxes
│   └── campaign_bounce   ← per-campaign bounce rate trending
│
├── External APIs
│   └── postmaster_monitor ← Google's domain reputation via Postmaster Tools API
│
└── daily_digest          ← queries InfluxDB, posts 0-100 health score to n8n
```

All modules write to InfluxDB. The scheduler runs every module at startup, then on independent intervals — no module failure can stop another.

---

## Modules

| Module | Schedule | What it does |
|---|---|---|
| `domain_discovery` | Every 6h | Pulls all sending domains + IPs from Smartlead. All other modules consume this list — no manual config needed. |
| `dmarc_validator` | Every 24h | Validates SPF, DMARC, DKIM, MTA-STS, BIMI DNS records per domain. Catches misconfigurations before parsedmarc does. |
| `rbl_monitor` | Every 12h | Checks all domains against 4 domain DNSBLs + all sending IPs against 42 IP DNSBLs using pydnsbl. |
| `spf_ip_validator` | Every 24h | Walks the SPF include chain for each domain and confirms your actual sending IPs are authorized. Catches the silent case where SPF is valid but the wrong IP is sending. |
| `smartlead_health` | Every 6h | Fetches domain-wise and mailbox-wise health metrics from Smartlead Global Analytics API. |
| `warmup_stats` | Every 12h | Fetches warmup stats per mailbox from Smartlead. Replaces `smartlead_spam_audit.py` entirely — writes to InfluxDB instead of CSV. |
| `reconnect_monitor` | Every 6h | Checks all 45+ Google Workspace mailboxes for OAuth disconnects. Alerts before campaigns silently stop sending. |
| `campaign_bounce` | Every 6h | Checks bounce rate per active campaign. Catches a bad lead list burning a domain before the domain-level metric shows it. |
| `postmaster_monitor` | Every 24h | Fetches Google's own domain reputation signal (HIGH/MEDIUM/LOW/BAD), spam rate, and DKIM/DMARC/SPF success ratios via Postmaster Tools API. |
| `daily_digest` | Daily 08:00 UTC | Queries all InfluxDB measurements, computes a 0-100 overall health score, posts one structured summary to n8n. |

---

## Project Structure

```
deliverability_monitor/
├── scheduler.py                    # Main entry point
├── requirements.txt
├── .env.example                    # Copy to .env and fill in
├── deliverability_monitor.service  # systemd unit file for GCP VM
├── config/
│   └── settings.py                 # All config and dataclasses
└── modules/
    ├── domain_discovery.py         # Smartlead domain + IP auto-discovery
    ├── influx_writer.py            # Shared InfluxDB writer + point builders
    ├── alerter.py                  # Alert dispatcher → n8n webhook
    ├── dmarc_validator.py          # checkdmarc DNS validator
    ├── rbl_monitor.py              # pydnsbl DNSBL checker
    ├── spf_ip_validator.py         # SPF IP authorization checker
    ├── smartlead_health.py         # Smartlead domain/mailbox health API
    ├── warmup_stats.py             # Smartlead per-mailbox warmup stats
    ├── reconnect_monitor.py        # Mailbox connection status monitor
    ├── campaign_bounce.py          # Per-campaign bounce rate monitor
    ├── postmaster_monitor.py       # Google Postmaster Tools integration
    └── daily_digest.py             # Daily health score digest
```

---

## Prerequisites

- Python 3.10+
- InfluxDB running on the VM (`http://localhost:8086`)
- Smartlead API key
- Google service account JSON key (for Postmaster Tools — optional but recommended)

---

## Installation

```bash
# Deploy to GCP VM
scp -r deliverability_monitor/ ubuntu@34.44.125.78:/opt/domain_health/
cd /opt/domain_health/deliverability_monitor

# Install dependencies
pip3 install -r requirements.txt --break-system-packages

# Configure (uses global .env from parent directory)
# Copy and edit the global .env.example at /opt/domain_health/.env.example
cp ../.env.example ../.env
nano ../.env   # fill in SMARTLEAD_API_KEY, INFLUXDB_TOKEN at minimum
```

The domain list is **auto-discovered** from Smartlead on startup — no manual list to maintain.

---

## Configuration

All config lives in the **global `.env` file** at the project root (`../.env`). Minimal required:

```env
SMARTLEAD_API_KEY=your_key
INFLUXDB_TOKEN=your_token
```

Recommended additional variables from the global `.env`:

```env
ALERT_WEBHOOK_URL=https://n8n.pintel.ai/webhook/deliverability-alerts
POSTMASTER_CREDENTIALS_PATH=/opt/domain_health/deliverability_monitor/postmaster-sa.json
```

See the global `../.env.example` for the full reference with defaults.

The static `SENDING_DOMAINS` list in `config/settings.py` is a **fallback only** — used if Smartlead is unreachable at startup. Normally the monitor self-discovers all domains.

---

## Running

### Test a single module

```bash
cd /opt/domain_health/deliverability_monitor

python3 scheduler.py --module discovery    # test domain discovery first
python3 scheduler.py --module dmarc       # DNS validation
python3 scheduler.py --module rbl         # blacklist check
python3 scheduler.py --module reconnect   # mailbox connection check
python3 scheduler.py --module warmup      # warmup stats (takes ~1min for 164 mailboxes)
python3 scheduler.py --module postmaster  # Google reputation (needs credentials)
```

### Run everything once (cron or smoke test)

```bash
python3 scheduler.py --once
```

### Long-running daemon

```bash
python3 scheduler.py
# Runs all modules immediately, then on their intervals. Logs to stdout + /var/log/deliverability_monitor.log
```

---

## Systemd Service

```bash
sudo cp deliverability_monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now deliverability_monitor
sudo journalctl -u deliverability_monitor -f
```

---

## Google Postmaster Tools Setup

Postmaster Tools gives you Google's own view of your domain reputation — the most authoritative signal for Gmail deliverability.

### 1. Register your domains

Go to [postmaster.google.com](https://postmaster.google.com), add and verify each sending domain.

### 2. Create a service account

In Google Cloud Console:
- Create a service account in your project
- Grant it no roles (Postmaster API uses domain-level access, not project roles)
- Download the JSON key → save as `/opt/deliverability_monitor/postmaster-sa.json`

### 3. Grant domain access

In Postmaster Tools → Settings → Users, add the service account email as a user for each domain.

### 4. Enable the API

In Google Cloud Console → APIs & Services → Enable: **Gmail Postmaster Tools API**

### 5. Configure

```env
POSTMASTER_CREDENTIALS_PATH=/opt/deliverability_monitor/postmaster-sa.json
```

If `POSTMASTER_CREDENTIALS_PATH` is not set, the module logs a warning and skips gracefully — it will not crash the scheduler.

---

## InfluxDB Measurements

All data lands in the `deliverability` bucket (configurable via `INFLUXDB_BUCKET`).

### `rbl_check`
*Written every 12h by `rbl_monitor`*

| Tag | Description |
|---|---|
| `domain` | Domain or IP checked |
| `check_type` | `domain` or `ip` |

| Field | Type | Description |
|---|---|---|
| `blacklisted` | int 0/1 | Listed on any DNSBL |
| `list_count` | int | Number of lists that flagged it |
| `detected_by` | string | Comma-separated provider names |
| `categories` | string | DNSBL category labels |

---

### `dmarc_dns_check`
*Written every 24h by `dmarc_validator`*

| Tag | Description |
|---|---|
| `domain` | Sending domain |
| `record_type` | `spf`, `dmarc`, `dkim`, `mta_sts`, `bimi`, or `composite_score` |

| Field | Type | Description |
|---|---|---|
| `valid` | int 0/1 | Record is valid |
| `policy` | string | SPF qualifier or DMARC policy |
| `error` | string | Error detail if invalid |
| `score` | float | 0–100 DNS health score (`composite_score` only) |

**Score weights:** SPF 25pts · DMARC policy 35pts (reject=35, quarantine=24, none=10) · DKIM 25pts · MTA-STS 10pts · BIMI 5pts

**Dashboard query — composite score per domain:**
```flux
from(bucket: "deliverability")
  |> range(start: -48h)
  |> filter(fn: (r) => r._measurement == "dmarc_dns_check"
      and r.record_type == "composite_score" and r._field == "score")
  |> last()
```

---

### `smartlead_health`
*Written every 6h by `smartlead_health`. Two grains via the `grain` tag.*

| Tag | Description |
|---|---|
| `domain` | Sending domain |
| `grain` | `domain` (aggregated) or `mailbox` (per address) |
| `email` | Individual address (`grain=mailbox` only) |

| Field | Type | Description |
|---|---|---|
| `inbox_pct` | float | % landing in inbox |
| `spam_pct` | float | % landing in spam |
| `bounce_rate` | float | Bounce rate |
| `sent_count` | int | Sends in the lookback window |
| `open_rate` | float | Open rate |
| `reply_rate` | float | Reply rate |
| `health_score` | float | Composite 0–100 (`grain=mailbox` only) |

---

### `warmup_stats`
*Written every 12h by `warmup_stats`. One row per mailbox.*

| Tag | Description |
|---|---|
| `email` | Mailbox address |
| `domain` | Sending domain |
| `account_id` | Smartlead account ID |

| Field | Type | Description |
|---|---|---|
| `inbox_pct` | float | Warmup inbox % (last 7 days) |
| `spam_pct` | float | Warmup spam % (last 7 days) |
| `health_score` | float | 0–100 warmup health score |
| `total_sent` | int | Warmup sends in window |
| `warmup_enabled` | int 0/1 | Warmup active |

---

### `mailbox_status`
*Written every 6h by `reconnect_monitor`. One row per mailbox.*

| Tag | Description |
|---|---|
| `email` | Mailbox address |
| `domain` | Sending domain |
| `account_id` | Smartlead account ID |

| Field | Type | Description |
|---|---|---|
| `connected` | int 0/1 | Account is connected |
| `needs_reconnect` | int 0/1 | Reconnect required |
| `status` | string | Raw status string from Smartlead |

---

### `campaign_bounce`
*Written every 6h by `campaign_bounce`. One row per active campaign.*

| Tag | Description |
|---|---|
| `campaign_id` | Smartlead campaign ID |
| `campaign_name` | Campaign name |
| `domain` | Sending domain |
| `status` | Campaign status |

| Field | Type | Description |
|---|---|---|
| `bounce_rate` | float | Bounce % |
| `sent` | int | Total sends |
| `open_rate` | float | Open % |
| `reply_rate` | float | Reply % |

---

### `postmaster_metrics`
*Written every 24h by `postmaster_monitor`. One row per verified domain.*

| Tag | Description |
|---|---|
| `domain` | Sending domain |
| `domain_reputation_label` | `HIGH`, `MEDIUM`, `LOW`, or `BAD` |

| Field | Type | Description |
|---|---|---|
| `domain_reputation` | int | 4=HIGH, 3=MEDIUM, 2=LOW, 1=BAD, 0=unknown |
| `spam_rate` | float | Google's measured spam rate (0–1) |
| `ip_reputation` | int | Worst IP reputation score |
| `dkim_success_ratio` | float | DKIM pass ratio |
| `dmarc_success_ratio` | float | DMARC pass ratio |
| `spf_success_ratio` | float | SPF pass ratio |

---

### `spf_ip_validation`
*Written every 24h by `spf_ip_validator`. One row per domain+IP pair.*

| Tag | Description |
|---|---|
| `domain` | Sending domain |
| `ip` | Sending IP address |

| Field | Type | Description |
|---|---|---|
| `authorized` | int 0/1 | IP is authorized in SPF |
| `mechanism_matched` | string | Which SPF mechanism matched (e.g. `include:_spf.google.com → ip4:...`) |
| `dns_lookups` | int | DNS lookups consumed (RFC limit is 10) |

---

## Alerts

All alerts POST JSON to `ALERT_WEBHOOK_URL` (your n8n webhook). The payload always includes `event`, `subject`, `timestamp`, and `source`.

**Alert events:**

| Event | Module | Trigger |
|---|---|---|
| `blacklist_detected` | rbl_monitor | Any domain/IP listed on ≥1 DNSBL |
| `dns_validation_failed` | dmarc_validator | DNS composite score < `ALERT_THRESHOLD_DMARC_SCORE` (default 70) |
| `spf_ip_not_authorized` | spf_ip_validator | Any sending IP not in SPF record |
| `high_spam_rate` | smartlead_health | Domain spam% > `ALERT_THRESHOLD_SPAM_PCT` (default 30%) |
| `warmup_high_spam` | warmup_stats | Mailbox warmup spam% > threshold |
| `mailbox_reconnect_required` | reconnect_monitor | Any account disconnected or needs reconnect |
| `high_campaign_bounce_rate` | campaign_bounce | Campaign bounce% > `CAMPAIGN_BOUNCE_THRESHOLD` (default 3%) |
| `postmaster_poor_reputation` | postmaster_monitor | Domain reputation is LOW or BAD |
| `daily_digest` | daily_digest | Daily — overall health score + all section summaries |

**n8n routing:** Use a Switch node on `event` to route each alert type to the appropriate Slack channel or email. The `daily_digest` event goes to a summary channel; threshold alerts go to an ops channel.

---

## Overall Health Score

The daily digest computes a single 0–100 account health score:

| Condition | Deduction |
|---|---|
| Each blacklisted domain | −10pts (max −30) |
| DNS score below 80 | −0.5pts per point below 80 |
| Average spam% above 10% | −1.5pts per point above 10% (max −30) |
| Each mailbox needing reconnect | −3pts (max −15) |
| Each domain with LOW/BAD Postmaster reputation | −15pts (max −30) |

Score interpretation: 85–100 = Healthy · 65–84 = Needs Attention · 0–64 = Critical

---

## Troubleshooting

**`KeyError: SMARTLEAD_API_KEY`** — Global `.env` file missing or not found. Always run from `/opt/domain_health/deliverability_monitor` and ensure the global `.env` exists at `/opt/domain_health/.env`.

**Domain list is empty on first run** — Smartlead API unreachable. Check `SMARTLEAD_API_KEY`. The static `SENDING_DOMAINS` in `config/settings.py` is the fallback.

**`No nameservers`** — DNS resolver issue on the VM. The DMARC validator uses `8.8.8.8` / `1.1.1.1` hardcoded, so this shouldn't occur. Fix with: `echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf`.

**InfluxDB write failed** — Check token has write permission on the `deliverability` bucket. Check InfluxDB is running: `systemctl status influxdb`.

**Warmup stats slow** — Expected. 164 mailboxes × 0.3s delay = ~50s per run. Adjust `WARMUP_BATCH_DELAY_SECS` if needed (don't go below 0.2s or Smartlead may rate-limit).

**Postmaster returns no data** — Normal for newly verified domains. Google has a 2–3 day data lag and only shows data for domains with significant send volume.

**`google.auth.exceptions.DefaultCredentialsError`** — Service account JSON path wrong, or API not enabled. Verify `POSTMASTER_CREDENTIALS_PATH` points to a valid file and the Gmail Postmaster Tools API is enabled in your Google Cloud project.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMARTLEAD_API_KEY` | Yes | — | Smartlead API key |
| `INFLUXDB_TOKEN` | Yes | — | InfluxDB write token |
| `INFLUXDB_URL` | No | `http://localhost:8086` | InfluxDB URL |
| `INFLUXDB_ORG` | No | `pintel` | InfluxDB org |
| `INFLUXDB_BUCKET` | No | `deliverability` | InfluxDB bucket |
| `POSTMASTER_CREDENTIALS_PATH` | No | — | Path to Google service account JSON |
| `ALERT_WEBHOOK_URL` | No | — | n8n webhook URL |
| `ALERT_THRESHOLD_SPAM_PCT` | No | `30.0` | Spam % alert threshold |
| `ALERT_THRESHOLD_BLACKLIST` | No | `1` | Min DNSBL hits to alert |
| `ALERT_THRESHOLD_DMARC_SCORE` | No | `70` | DNS composite score alert threshold |
| `DIGEST_HOUR_UTC` | No | `8` | Daily digest send hour (UTC) |
| `WARMUP_BATCH_DELAY_SECS` | No | `0.3` | Delay between per-mailbox warmup API calls |
| `CAMPAIGN_BOUNCE_THRESHOLD` | No | `3.0` | Campaign bounce % alert threshold |
| `RBL_CHECK_INTERVAL_HOURS` | No | `12` | DNSBL check frequency |
| `DMARC_CHECK_INTERVAL_HOURS` | No | `24` | DNS validation frequency |
| `SMARTLEAD_POLL_INTERVAL_HOURS` | No | `6` | Smartlead API poll frequency |
| `WARMUP_INTERVAL_HOURS` | No | `12` | Warmup stats fetch frequency |
| `RECONNECT_INTERVAL_HOURS` | No | `6` | Mailbox reconnect check frequency |
| `CAMPAIGN_BOUNCE_INTERVAL_HOURS` | No | `6` | Campaign bounce check frequency |
| `POSTMASTER_INTERVAL_HOURS` | No | `24` | Postmaster Tools fetch frequency |
| `SPF_IP_INTERVAL_HOURS` | No | `24` | SPF IP validation frequency |
