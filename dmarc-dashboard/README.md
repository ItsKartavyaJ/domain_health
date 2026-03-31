# DMARC Dashboard (React + Vite)

Frontend dashboard for viewing DMARC health from the same InfluxDB stack used by:

- `parsedmarc-stack` (writes DMARC data to bucket `dmarc`)
- `deliverability_monitor` (writes deliverability data to bucket `deliverability`)

This dashboard currently reads DMARC aggregate data from InfluxDB v2 measurement `dmarc_aggregate`.

---

## Integration Prerequisites

Before running this app with live data, make sure:

1. `parsedmarc-stack` is up and writing to InfluxDB (`dmarc` bucket)
2. InfluxDB v2 endpoint is reachable (`https://influx.pintel.ai` or local)
3. You have a valid InfluxDB v2 token with read access to the `dmarc` bucket
4. The global `.env` file at the project root is configured (see `../.env.example`)

---

## Configuration

The dashboard uses environment variables from the **global `.env` file at the project root** (`../.env`).

Required variables from the global `.env`:

```env
API_PORT=8787
API_AUTH_USER=authuser
API_AUTH_PASSWORD=replace_with_strong_password
API_JWT_SECRET=replace_with_long_random_secret

INFLUX_URL=https://influx.pintel.ai   # or http://localhost:8086 for local
INFLUX_ORG=pintel
INFLUX_BUCKET=dmarc
INFLUX_TOKEN=your_influxdb_token
```

The `INFLUX_TOKEN` should match `INFLUXDB_TOKEN` from the global `.env` file.

Notes:

- Login accepts only the configured `API_AUTH_USER` (default `authuser`) + `API_AUTH_PASSWORD`.
- All metrics API routes are protected by auth cookie + JWT verification.
- Influx token is server-side only (not exposed to the browser).

---

## Run

```bash
npm install
npm run dev
```

In a second terminal, run the API server:

```bash
npm run dev:api
```

Build production bundle:

```bash
npm run build
```
