# Diagnostic Steps for DMARC Domain Counts

Use these checks when the dashboard shows fewer DMARC domains than expected.

## 1. Check aggregate.json Content

```bash
docker exec parsedmarc sh -c 'ls -lh /data && du -h /data/* 2>/dev/null'
docker exec parsedmarc sh -c 'cat /data/aggregate.json | jq -r ".[].policy_published.domain" | sort -u | wc -l'
```

If `aggregate.json` is not growing, inspect parsedmarc logs and the DMARC mailbox.

## 2. Check parsedmarc Logs

```bash
docker logs parsedmarc 2>&1 | grep -i -E "imap|error|failed|archive|report" | tail -50
```

In the current sidecar setup, parsedmarc writes files only. It does not write directly to InfluxDB.

## 3. Check influx_writer Progress

```bash
docker logs influx_writer 2>&1 | tail -50
```

Look for:

- `[OK] wrote X points from Y new reports`
- `compacted aggregate file`
- `[ERROR] InfluxDB`
- warnings about corrupt or partial JSON at the tail

## 4. Query InfluxDB Directly

Open `http://localhost:8086` on the VM or query with the CLI:

```bash
docker exec influxdb influx query \
  --org "$INFLUXDB_ORG" --token "$INFLUXDB_TOKEN" \
  'from(bucket:"dmarc") |> range(start:-30d) |> filter(fn: (r) => r._measurement == "dmarc_aggregate") |> keep(columns:["header_from"]) |> distinct(column:"header_from")'
```

## Expected Flow

1. `parsedmarc` reads Gmail and writes `/data/aggregate.json`.
2. `influx_writer` reads that file every 30 seconds and writes new reports to InfluxDB.
3. After successful writes, `influx_writer` compacts the processed prefix out of `aggregate.json`.
4. The dashboard API queries InfluxDB and returns domains.

If domains are present in `aggregate.json` but missing from InfluxDB, focus on `influx_writer`. If domains are present in InfluxDB but missing from the dashboard, focus on the dashboard API cache/query.
