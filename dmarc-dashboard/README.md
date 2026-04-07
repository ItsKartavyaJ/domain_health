# DMARC & Email Deliverability Dashboard

React 19 + Express 5 dashboard for monitoring email deliverability health, DMARC compliance, and Smartlead campaign performance.

## Features

- **Overview** — DMARC aggregate stats from InfluxDB with domain pass-rate alerts
- **Replies** — Reply category breakdown (pie chart), daily positive reply trends, per-campaign response stats
- **Mailboxes** — Mailbox health table with status badges (active/inactive/disconnected), domain-level and provider-level performance, warmup status
- **Campaigns** — Campaign funnel (sent → opened → replied → positive), daily email activity chart, filterable by status (Active/Paused/Completed/Drafted) with search and sortable columns
- **Sequences** — Per-campaign sequence performance comparison

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Recharts, Vite 8 |
| Backend | Express 5 (Node.js) |
| Auth | Firebase Authentication (Google sign-in, restricted to `@pintel.ai`) |
| Data | InfluxDB 2.7 (DMARC), Smartlead Analytics API (campaigns/mailboxes) |

## Prerequisites

1. **parsedmarc-stack** running and writing DMARC data to InfluxDB (`dmarc` bucket)
2. InfluxDB v2 reachable with a valid read token
3. Smartlead API key for campaign/mailbox analytics
4. Firebase project configured for Google sign-in

## Configuration

Create a `.env` file in this directory (`dmarc-dashboard/.env`):

```env
# Server
API_PORT=8787

# Firebase Auth
FIREBASE_PROJECT_ID=your-firebase-project-id

# Firebase Client (baked at build time)
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
VITE_FIREBASE_APP_ID=your-app-id

# InfluxDB
INFLUX_URL=http://localhost:8086
INFLUX_ORG=pintel
INFLUX_BUCKET=dmarc
INFLUX_TOKEN=your-influxdb-token

# Smartlead
SMARTLEAD_API_KEY=your-smartlead-api-key
```

> **Note:** `VITE_` variables are baked into the frontend at build time. Run `npm run build` after changing them.

## Development

```bash
npm install

# Terminal 1 — Vite dev server (hot reload) at :5173
npm run dev

# Terminal 2 — Express API at :8787
npm run dev:api
```

Vite proxies `/api` requests to `:8787` in development.

## Production

```bash
npm run build         # Bundle frontend → dist/
npm run start:api     # Serve API + built frontend on :8787
```

## Project Structure

```
dmarc-dashboard/
├── server/
│   ├── index.js          # Express server, Firebase auth middleware, InfluxDB queries
│   └── smartlead.js      # Smartlead API proxy (14 endpoints, paginated)
├── src/
│   ├── api/
│   │   ├── auth.js       # Firebase auth (Google sign-in)
│   │   ├── influx.js     # InfluxDB API client
│   │   └── smartlead.js  # Smartlead API client (12 functions)
│   ├── components/
│   │   ├── Badge.jsx     # Status badge (ok/warn/err)
│   │   ├── DateFilter.jsx
│   │   ├── DomainCard.jsx
│   │   └── DomainTable.jsx
│   ├── pages/
│   │   ├── Overview.jsx  # DMARC domain stats
│   │   ├── Replies.jsx   # Reply intelligence
│   │   ├── Mailboxes.jsx # Mailbox health
│   │   ├── Campaigns.jsx # Campaign funnel & table
│   │   ├── Sequences.jsx # Sequence analytics
│   │   └── Login.jsx     # Google sign-in
│   ├── App.jsx           # Tab navigation, auth guard
│   └── index.css         # CSS variables (light/dark mode)
└── package.json
```

## Auth

- Firebase Authentication with Google sign-in
- Server verifies Firebase ID tokens via Admin SDK (no service account needed — uses public JWKS)
- Restricted to `@pintel.ai` email domain
- VM IP must be added to Firebase Console → Authentication → Authorized domains

## Lint

```bash
npm run lint
```
