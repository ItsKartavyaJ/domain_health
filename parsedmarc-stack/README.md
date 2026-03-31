# Pintel DMARC Stack

Self-hosted DMARC report parsing and visualization stack for GCP VM (`34.44.125.78`). Reads DMARC aggregate and forensic reports from a Gmail inbox, stores them in InfluxDB, and visualizes them in Grafana.

The same InfluxDB instance is shared with `deliverability_monitor` — both stacks write to the same database, with separate buckets (`dmarc` and `deliverability`).

---

## Stack

| Service | Image | Purpose |
|---|---|---|
| `parsedmarc` | custom (Python 3.12) | Watches Gmail inbox, parses DMARC reports, writes to InfluxDB |
| `influxdb` | `influxdb:2.7-alpine` | Time-series storage — shared with deliverability_monitor |
| `grafana` | `grafana/grafana:10.4-ubuntu` | DMARC dashboards at `dmarc.pintel.ai` |
| `caddy` | `caddy:2-alpine` | Reverse proxy with auto-TLS for `dmarc.pintel.ai` and `influx.pintel.ai` |

---

## Prerequisites

### 1. Gmail mailbox with app password

parsedmarc reads your DMARC mailbox via IMAP using a Gmail app password.

**Steps:**

1. Create/use a dedicated Gmail mailbox (e.g. `dmarc@pintel.ai`)
2. Enable IMAP in Gmail settings
3. Enable 2-Step Verification on the mailbox account
4. Generate a Gmail App Password (Mail app)
5. Add `rua=mailto:dmarc@pintel.ai` to all sending domain DMARC records

### 2. DNS records

Point these at your GCP VM IP (`34.44.125.78`):

```
dmarc.pintel.ai    A  34.44.125.78
influx.pintel.ai   A  34.44.125.78
```

### 3. GCP firewall rules

Allow inbound TCP on ports 80 and 443:

```bash
gcloud compute firewall-rules create allow-http-https \
  --allow tcp:80,tcp:443 \
  --target-tags=http-server,https-server \
  --description="Allow HTTP and HTTPS for DMARC stack"
```

---

## Installation

```bash
# On the GCP VM
git clone / scp parsedmarc-stack/ to /opt/domain_health/parsedmarc-stack
cd /opt/domain_health/parsedmarc-stack

# Configure (uses global .env from parent directory)
# Copy and edit the global .env.example at /opt/domain_health/.env.example
cp ../.env.example ../.env
nano ../.env   # fill in all values

# Build and start
docker compose build
docker compose up -d

# Tail logs
docker compose logs -f parsedmarc
```

---

## Configuration

All config is in the **global `.env` file** at the project root (`../.env`). Never commit this file.

| Variable | Description |
|---|---|
| `DMARC_MAILBOX_USER` | Gmail address receiving DMARC reports (e.g. `dmarc@pintel.ai`) |
| `DMARC_IMAP_HOST` | IMAP host (`imap.gmail.com`) |
| `DMARC_IMAP_PORT` | IMAP SSL port (`993`) |
| `DMARC_MAILBOX_APP_PASSWORD` | Gmail app password for the DMARC mailbox |
| `INFLUXDB_ADMIN_USER` | InfluxDB admin username |
| `INFLUXDB_ADMIN_PASSWORD` | InfluxDB admin password — make this strong |
| `INFLUXDB_ORG` | InfluxDB org name — use `pintel` to match deliverability_monitor |
| `INFLUXDB_TOKEN` | InfluxDB API token — same token used by deliverability_monitor |
| `INFLUXDB_DMARC_BUCKET` | Bucket for DMARC data — use `dmarc` |
| `GRAFANA_ADMIN_USER` | Grafana admin username |
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin password |

**Important:** `INFLUXDB_ORG` and `INFLUXDB_TOKEN` in the global `.env` must match exactly what you use in `deliverability_monitor` so both stacks share the same InfluxDB instance.

---

## Setting up DMARC records

For every sending domain, add or update the DMARC TXT record:

```
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@pintel.ai; ruf=mailto:dmarc@pintel.ai; fo=1; adkim=s; aspf=s"
```

Policy progression (start with `none`, move to `quarantine`, then `reject`):

| Policy | Effect | When to use |
|---|---|---|
| `none` | Monitor only — no filtering | New domains, first 30 days |
| `quarantine` | Failing mail goes to spam | After confirming SPF/DKIM alignment |
| `reject` | Failing mail is rejected | When you're confident in alignment |

You'll typically start seeing DMARC reports within 24–48 hours of adding the record. Most major senders (Google, Microsoft, Yahoo) send aggregate reports daily.

---

## Grafana dashboards

Grafana is pre-configured with automatic datasource provisioning pointing at InfluxDB. On first login (`dmarc.pintel.ai`), you'll need to import the parsedmarc dashboard.

### Import the official parsedmarc dashboard

The parsedmarc project maintains an official Grafana dashboard JSON. Import it manually:

1. Go to `dmarc.pintel.ai` → Login with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`
2. Dashboards → Import → paste URL: `https://raw.githubusercontent.com/domainaware/parsedmarc/master/grafana/Grafana-DMARC_Reports.json`
3. Select `InfluxDB-DMARC` as the datasource
4. Save

The dashboard shows:
- DMARC pass/fail by source IP and sending domain
- SPF and DKIM alignment breakdown
- Volume by reporting org (Google, Microsoft, Yahoo, etc.)
- Geographic source map
- Time-series trends

---

## How parsedmarc connects to InfluxDB

parsedmarc natively supports InfluxDB v2 output via the `[influxdb]` config section (or `PARSEDMARC_INFLUXDB_*` env vars). It writes two measurements:

| Measurement | Content |
|---|---|
| `dmarc_aggregate` | Aggregate report data — SPF/DKIM pass rates, policy applied, source IP |
| `dmarc_forensic` | Forensic (failure) reports — full headers of failing messages |

These live in the `dmarc` bucket. Your existing deliverability_monitor data lives in the `deliverability` bucket. Grafana has datasources pointing at both.

---

## Integrating with deliverability_monitor

The InfluxDB token and org in the global `.env` must match what deliverability_monitor uses:

```bash
# The global .env file should have:
INFLUXDB_TOKEN=same_token
INFLUXDB_ORG=pintel
```

Update `deliverability_monitor` to use the shared InfluxDB:
```env
INFLUXDB_URL=http://localhost:8086   # InfluxDB is on the same VM, use localhost
```

The deliverability_monitor runs directly on the host (via systemd), connecting to InfluxDB via `localhost:8086` which is port-mapped from the Docker container.

---

## InfluxDB buckets

After first start, two buckets will exist:

| Bucket | Created by | Contains |
|---|---|---|
| `dmarc` | Docker init (`DOCKER_INFLUXDB_INIT_BUCKET`) | DMARC aggregate + forensic reports from parsedmarc |
| `deliverability` | `influxdb/init/01-create-buckets.sh` | RBL, DNS, warmup, reconnect, campaign, postmaster metrics |

To verify buckets exist:

```bash
docker exec influxdb influx bucket list --token $INFLUXDB_TOKEN --org pintel
```

---

## Useful commands

```bash
# Start everything
docker compose up -d

# Stop everything
docker compose down

# Rebuild parsedmarc image after update
docker compose build parsedmarc && docker compose up -d parsedmarc

# Follow parsedmarc logs (watch it process reports)
docker compose logs -f parsedmarc

# Check all container health
docker compose ps

# Restart just one service
docker compose restart parsedmarc

# Upgrade parsedmarc to latest version
docker compose build --no-cache parsedmarc
docker compose up -d parsedmarc

# Connect to InfluxDB CLI
docker exec -it influxdb influx --token $INFLUXDB_TOKEN

# Check InfluxDB has data
docker exec influxdb influx query \
  --org pintel --token $INFLUXDB_TOKEN \
  'from(bucket:"dmarc") |> range(start:-24h) |> limit(n:5)'
```

---

## Troubleshooting

**parsedmarc exits immediately with no output**
Check IMAP settings and app password in `.env`: `DMARC_MAILBOX_USER`, `DMARC_IMAP_HOST`, `DMARC_IMAP_PORT`, `DMARC_MAILBOX_APP_PASSWORD`. Also verify IMAP is enabled in Gmail mailbox settings.

**InfluxDB init fails on restart**
The init scripts in `influxdb/init/` only run on first startup (when the volume is empty). Safe to restart — they won't re-run if the volume already exists.

**Caddy can't get TLS certificate**
Port 80 must be open in GCP firewall and the DNS records must resolve to `34.44.125.78`. Check: `curl http://dmarc.pintel.ai` from outside the VM. Caddy logs: `docker compose logs caddy`.

**No DMARC reports appearing**
- DMARC records need 24–48 hours before reports arrive
- Verify records: `dig TXT _dmarc.pintel.ai`
- Check parsedmarc is watching: `docker compose logs parsedmarc | grep -i watch`
- Manually test by forwarding a raw DMARC report XML to the inbox

**Grafana shows "No data"**
The datasource substitutes `${INFLUXDB_ORG}` etc. at provisioning time — these come from Grafana's own environment, not Docker env. If datasource shows disconnected, edit it manually in Grafana UI and re-enter the token.

---

## Backfilling historical reports

If you have existing DMARC reports saved as XML or ZIP files:

```bash
# Copy files into the container and parse them manually
docker cp ./my-reports/ parsedmarc:/tmp/reports/
docker exec parsedmarc parsedmarc \
  --debug \
  /tmp/reports/*.xml /tmp/reports/*.zip
```

Or mount a directory as a volume and parse on startup — update `docker-compose.yml`:

```yaml
parsedmarc:
  command: ["--debug", "/reports/*"]
  volumes:
    - /path/to/saved/reports:/reports:ro
```

---

## Security notes

- Never commit `.env` with `DMARC_MAILBOX_APP_PASSWORD`
- InfluxDB token should be a long random string (32+ chars)
- Grafana is behind Caddy with HTTPS — never expose port 3000 directly via GCP firewall
- InfluxDB port 8086 is exposed on `localhost` only for `deliverability_monitor` — the GCP firewall should block port 8086 from external access (use `influx.pintel.ai` via Caddy instead)
- Add `.env` to `.gitignore`
