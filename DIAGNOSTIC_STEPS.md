# Diagnostic Steps to Find the 8-Domain Bottleneck

After the latest fixes (Flux query improvements + InfluxDB v2 config), use these steps to identify where data is being lost.

## 1. Test the Fixed Diagnostic Endpoint

```bash
# SSH to VM, then:
curl http://localhost:8787/api/debug/influx-cardinality 2>/dev/null | jq
```

**What to look for:**
- `unique_domain_count`: How many distinct domains are in InfluxDB?
  - If still 8 → parsedmarc's direct write isn't working
  - If > 8 → data IS in InfluxDB, Overview will show it after refresh
- `total_records`: Total DMARC_aggregate records in InfluxDB

## 2. Check aggregate.json Content

```bash
# See how many unique domains in the file
docker exec parsedmarc sh -c 'cat /data/aggregate.json | jq -r ".[].policy_published.domain" | sort -u | wc -l'

# Or just count lines if it's line-delimited JSON
wc -l /data/aggregate.json
```

## 3. Check parsedmarc Logs for InfluxDB Errors

```bash
docker logs parsedmarc 2>&1 | grep -i -E "influx|error|failed" | tail -30
```

Look for:
- "writing to influxdb" (success indicator)
- Connection errors
- Write failures

## 4. Check influx_writer Progress

```bash
docker logs influx_writer 2>&1 | tail -50
```

Look for:
- `[OK] wrote X points from Y new reports` → it's processing new data
- `[ERROR] InfluxDB` → write failures
- Check if it's seeing NEW reports beyond the initial 8

## 5. Rebuild and Redeploy Dashboard

```bash
cd dmarc-dashboard
npm run build
docker compose up -d dmarc-dashboard  # or wherever the dashboard is deployed
```

Then refresh the browser at `http://localhost:8787`.

## 6. Query InfluxDB Directly (via Grafana or UI)

Navigate to `http://localhost:3000` (Grafana) or `http://localhost:8086` (InfluxDB UI) and run a Flux query:

```flux
from(bucket: "dmarc")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "dmarc_aggregate")
  |> keep(columns: ["header_from"])
  |> distinct(column: "header_from")
```

Count the results to see unique domains.

## Expected Flow

1. **parsedmarc** reads Gmail → processes reports → writes to:
   - `/data/aggregate.json` (always)
   - InfluxDB directly (after ccfd25a fix)

2. **influx_writer** reads aggregate.json every 30s → writes new reports to InfluxDB

3. **Dashboard API** queries InfluxDB → returns domains

If only 8 domains in InfluxDB after all these steps → issue is in parsedmarc's InfluxDB write or environment config.
