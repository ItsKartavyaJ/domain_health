# Pintel DMARC Stack

Self-hosted DMARC report parsing stack for the GCP VM. It reads DMARC aggregate reports from a Gmail inbox, stores normalized points in InfluxDB, and exposes InfluxDB through Caddy when remote access is needed.

The same InfluxDB instance is shared with `deliverability_monitor`, using separate buckets:

- `dmarc` for parsedmarc aggregate report data
- `deliverability` for scheduled DNS, RBL, Smartlead, warmup, bounce, and Postmaster checks

## Stack

| Service | Image | Purpose |
|---|---|---|
| `parsedmarc` | custom Python 3.12 image | Processes the Gmail inbox once per interval and writes `/data/aggregate.json` |
| `influx_writer` | custom Python 3.12 image | Tails `aggregate.json` and writes `dmarc_aggregate` points to InfluxDB |
| `influxdb` | `influxdb:2.7-alpine` | Time-series storage shared with `deliverability_monitor` |
| `caddy` | `caddy:2-alpine` | Optional reverse proxy with auto-TLS for `influx.pintel.ai` |

Grafana has intentionally been removed to reduce memory pressure on the VM. Use the React dashboard in `dmarc-dashboard/` for the main UI.

## Prerequisites

1. A Gmail mailbox with IMAP enabled and a Gmail app password.
2. DMARC records that send aggregate reports to that mailbox, for example:

```text
_dmarc.yourdomain.com TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@pintel.ai; fo=1; adkim=s; aspf=s"
```

3. A root-level `.env` file with the shared InfluxDB and mailbox settings.

## Configuration

This compose file uses the root `.env` through `env_file: ../.env`.

Required values:

| Variable | Description |
|---|---|
| `DMARC_MAILBOX_USER` | Gmail address receiving DMARC reports |
| `DMARC_IMAP_HOST` | IMAP host, usually `imap.gmail.com` |
| `DMARC_IMAP_PORT` | IMAP SSL port, usually `993` |
| `DMARC_MAILBOX_APP_PASSWORD` | Gmail app password |
| `INFLUXDB_ADMIN_USER` | InfluxDB initial admin username |
| `INFLUXDB_ADMIN_PASSWORD` | InfluxDB initial admin password |
| `INFLUXDB_ORG` | InfluxDB org name |
| `INFLUXDB_TOKEN` | Shared InfluxDB API token |
| `INFLUXDB_DMARC_BUCKET` | Bucket for DMARC data, usually `dmarc` |
| `PARSEDMARC_RUN_INTERVAL_SECONDS` | One-shot parsedmarc interval, default `3600` |

## Running

```bash
cd parsedmarc-stack
docker compose up -d --build
docker compose ps
docker compose logs -f parsedmarc influx_writer
```

To remove a previously deployed Grafana container after this change:

```bash
docker compose up -d --remove-orphans
docker rm -f grafana 2>/dev/null || true
docker volume rm parsedmarc-stack_grafana_data 2>/dev/null || true
```

The volume removal is optional; skip it if you want to keep old Grafana data around.

## Data Flow

1. `parsedmarc` connects to the DMARC Gmail mailbox over IMAP once per interval.
2. It parses complete aggregate reports and appends them to `/data/aggregate.json`.
3. `influx_writer` reads that shared file from the `parsedmarc_data` Docker volume.
4. The sidecar writes `dmarc_aggregate` points to the `dmarc` bucket in InfluxDB.
5. After a successful write, the sidecar compacts `aggregate.json` by removing the safely processed prefix and preserving any partial tail.
6. The React dashboard queries the InfluxDB API through `dmarc-dashboard/server/index.js`.

## Useful Commands

```bash
# Follow logs
docker compose logs -f parsedmarc influx_writer

# Check container health
docker compose ps

# Restart only parsedmarc and the sidecar
docker compose restart parsedmarc influx_writer

# Query recent DMARC points
docker exec influxdb influx query \
  --org "$INFLUXDB_ORG" --token "$INFLUXDB_TOKEN" \
  'from(bucket:"dmarc") |> range(start:-24h) |> limit(n:5)'

# Check aggregate file size
docker exec parsedmarc sh -c 'ls -lh /data && du -h /data/* 2>/dev/null'
```

## Troubleshooting

**parsedmarc exits immediately**

Check `DMARC_MAILBOX_USER`, `DMARC_IMAP_HOST`, `DMARC_IMAP_PORT`, and `DMARC_MAILBOX_APP_PASSWORD`. Also verify IMAP is enabled in Gmail.

**No DMARC reports appear**

- DMARC reports usually take 24-48 hours to arrive.
- Verify the DNS record: `dig TXT _dmarc.yourdomain.com`.
- Check `docker compose logs parsedmarc`.
- Check `docker compose logs influx_writer`.

**InfluxDB has no points**

Check whether `/data/aggregate.json` exists and whether `influx_writer` is logging write errors. Also confirm `INFLUXDB_ORG`, `INFLUXDB_TOKEN`, and `INFLUXDB_DMARC_BUCKET` match the InfluxDB initialization values.

**aggregate.json grows continuously**

`influx_writer` should log `compacted aggregate file` after successful writes. If it logs that compaction is deferred, parsedmarc is likely writing at the same time; the sidecar will retry on the next poll.

**Caddy cannot get a TLS certificate**

Port 80 must be open in GCP firewall and `influx.pintel.ai` must resolve to the VM IP. Check Caddy logs with `docker compose logs caddy`.

## Security Notes

- Never commit `.env`.
- Keep InfluxDB bound to localhost unless remote API access is required.
- If remote InfluxDB access is required, prefer the Caddy HTTPS hostname and token auth.
- The Grafana port `3000` is no longer used and should not be open in GCP firewall rules.
