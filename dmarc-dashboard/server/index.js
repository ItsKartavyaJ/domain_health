import dotenv from 'dotenv';
import express from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import path from 'path';
import { fileURLToPath } from 'url';
import smartleadRouter from './smartlead.js';

dotenv.config();

const PORT = Number(process.env.API_PORT || 8787);
const INFLUX_URL = process.env.INFLUX_URL || '';
const INFLUX_ORG = process.env.INFLUX_ORG || 'pintel';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'dmarc';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const ALLOWED_DOMAIN = 'pintel.ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

if (!INFLUX_URL || !INFLUX_TOKEN) {
  throw new Error('Missing INFLUX_URL or INFLUX_TOKEN in environment');
}
if (!FIREBASE_PROJECT_ID) {
  throw new Error('Missing FIREBASE_PROJECT_ID in environment');
}
if (!process.env.SMARTLEAD_API_KEY) {
  throw new Error('Missing SMARTLEAD_API_KEY in environment');
}

// Initialise firebase-admin (credential-less — uses project ID for token verification only)
if (!getApps().length) {
  initializeApp({ projectId: FIREBASE_PROJECT_ID });
}

const app = express();
app.use(express.json({ limit: '2kb' }));

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (!decoded.email || !decoded.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      return res.status(403).json({ error: 'Access restricted to @pintel.ai accounts' });
    }
    req.user = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function parseCsv(csvText) {
  const lines = csvText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function queryFlux(flux) {
  const endpoint = `${INFLUX_URL.replace(/\/$/, '')}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Token ${INFLUX_TOKEN}`,
      'Content-Type': 'application/vnd.flux',
      Accept: 'application/csv',
    },
    body: flux,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Influx query failed (${response.status}): ${body}`);
  }

  return parseCsv(await response.text());
}

async function getDomainStats() {
  let rows;
  try {
    rows = await queryFlux(`
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "dmarc_aggregate")
  |> filter(fn: (r) => r._field == "message_count" or r._field == "passed_dmarc" or r._field == "spf_aligned" or r._field == "dkim_aligned")
  |> pivot(rowKey: ["_time", "header_from"], columnKey: ["_field"], valueColumn: "_value")
  |> group(columns: ["header_from"])
  |> reduce(
      identity: {header_from: "", total: 0.0, passed: 0.0, spf_aligned_count: 0.0, dkim_aligned_count: 0.0},
      fn: (r, accumulator) => ({
        header_from: r.header_from,
        total: accumulator.total + float(v: if exists r.message_count then r.message_count else 0),
        passed: accumulator.passed + (if exists r.passed_dmarc and bool(v: r.passed_dmarc) then float(v: if exists r.message_count then r.message_count else 0) else 0.0),
        spf_aligned_count: accumulator.spf_aligned_count + (if exists r.spf_aligned and bool(v: r.spf_aligned) then float(v: if exists r.message_count then r.message_count else 0) else 0.0),
        dkim_aligned_count: accumulator.dkim_aligned_count + (if exists r.dkim_aligned and bool(v: r.dkim_aligned) then float(v: if exists r.message_count then r.message_count else 0) else 0.0),
      })
    )
  |> keep(columns: ["header_from", "total", "passed", "spf_aligned_count", "dkim_aligned_count"])
  |> sort(columns: ["total"], desc: true)
  |> limit(n: 1000)
`);
  } catch (err) {
    // Bucket empty or no dmarc_aggregate data yet — return empty
    if (err.message.includes('no results') || err.message.includes('not found') || err.message.includes('empty')) {
      return [];
    }
    throw err;
  }

  return rows
    .filter((r) => r.header_from)
    .map((r) => {
      const total = Math.round(toNumber(r.total));
      const passed = Math.round(toNumber(r.passed));
      const spfAligned = Math.round(toNumber(r.spf_aligned_count));
      const dkimAligned = Math.round(toNumber(r.dkim_aligned_count));
      const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
      const spfRate = total > 0 ? Math.round((spfAligned / total) * 100) : 0;
      const dkimRate = total > 0 ? Math.round((dkimAligned / total) * 100) : 0;

      return {
        domain: r.header_from || 'unknown',
        total,
        passed,
        rate,
        score: rate,
        spf: spfRate > 95 ? 'Pass' : spfRate > 70 ? 'Partial' : 'Fail',
        dkim: dkimRate > 95 ? 'Pass' : 'Fail',
        lastReport: 'recently',
        trend: 0,
        status: rate > 80 ? 'ok' : rate > 50 ? 'warn' : 'danger',
      };
    });
}

function getAlerts(domains) {
  return domains
    .map((d) => {
      if (d.rate === 100) {
        return {
          type: 'green',
          domain: d.domain,
          message: `${d.domain} — All checks passed`,
          desc: 'SPF, DKIM and DMARC are all aligned and passing.',
        };
      }
      if (d.rate < 50) {
        return {
          type: 'red',
          domain: d.domain,
          message: `${d.domain} — DMARC failure rate critical`,
          desc: `${100 - d.rate}% of emails are failing DMARC. Immediate action needed.`,
        };
      }
      return {
        type: 'amber',
        domain: d.domain,
        message: `${d.domain} — DMARC partially failing`,
        desc: `${100 - d.rate}% of emails failing. Check SPF/DKIM alignment.`,
      };
    })
    .slice(0, 8);
}

app.get('/api/auth/me', authMiddleware, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

app.get('/api/metrics/domain-stats', authMiddleware, async (_req, res) => {
  try {
    const domains = await getDomainStats();
    return res.json({ ok: true, domains });
  } catch (err) {
    console.error('[domain-stats]', err.message);
    return res.status(500).json({ error: 'Failed to load domain stats' });
  }
});

app.get('/api/metrics/alerts', authMiddleware, async (_req, res) => {
  try {
    const domains = await getDomainStats();
    return res.json({ ok: true, alerts: getAlerts(domains) });
  } catch {
    return res.status(500).json({ error: 'Failed to load alerts' });
  }
});

app.use('/api/smartlead', authMiddleware, smartleadRouter);

app.use(express.static(distPath));
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DMARC API server listening on ${PORT}`);
});
