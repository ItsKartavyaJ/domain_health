import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = Number(process.env.API_PORT || 8787);
const JWT_SECRET = process.env.API_JWT_SECRET;
const AUTH_USER = process.env.API_AUTH_USER || 'authuser';
const AUTH_PASSWORD = process.env.API_AUTH_PASSWORD || '';
const INFLUX_URL = process.env.INFLUX_URL || '';
const INFLUX_ORG = process.env.INFLUX_ORG || 'pintel';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'dmarc';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || '';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

if (!JWT_SECRET) {
  throw new Error('Missing API_JWT_SECRET in environment');
}
if (!AUTH_PASSWORD) {
  throw new Error('Missing API_AUTH_PASSWORD in environment');
}
if (!INFLUX_URL || !INFLUX_TOKEN) {
  throw new Error('Missing INFLUX_URL or INFLUX_TOKEN in environment');
}

app.use(express.json());
app.use(cookieParser());

function createToken(username) {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '12h' });
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.dmarc_auth;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload.sub;
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
  const rows = await queryFlux(`
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -48h)
  |> filter(fn: (r) => r._measurement == "dmarc_aggregate")
  |> filter(fn: (r) => r._field == "message_count" or r._field == "passed_dmarc" or r._field == "spf_aligned" or r._field == "dkim_aligned")
  |> pivot(rowKey: ["_time", "header_from"], columnKey: ["_field"], valueColumn: "_value")
  |> group(columns: ["header_from"])
  |> reduce(
      identity: {header_from: "", total: 0.0, passed: 0.0, spf_aligned_count: 0.0, dkim_aligned_count: 0.0},
      fn: (r, acc) => ({
        header_from: r.header_from,
        total: acc.total + float(v: if exists r.message_count then r.message_count else 0),
        passed: acc.passed + (if exists r.passed_dmarc and bool(v: r.passed_dmarc) then float(v: if exists r.message_count then r.message_count else 0) else 0.0),
        spf_aligned_count: acc.spf_aligned_count + (if exists r.spf_aligned and bool(v: r.spf_aligned) then float(v: if exists r.message_count then r.message_count else 0) else 0.0),
        dkim_aligned_count: acc.dkim_aligned_count + (if exists r.dkim_aligned and bool(v: r.dkim_aligned) then float(v: if exists r.message_count then r.message_count else 0) else 0.0),
      })
    )
  |> keep(columns: ["header_from", "total", "passed", "spf_aligned_count", "dkim_aligned_count"])
  |> sort(columns: ["total"], desc: true)
`);

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

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== AUTH_USER || password !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = createToken(username);
  res.cookie('dmarc_auth', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });

  return res.json({ ok: true, user: username });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('dmarc_auth');
  return res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

app.get('/api/metrics/domain-stats', authMiddleware, async (_req, res) => {
  try {
    const domains = await getDomainStats();
    return res.json({ ok: true, domains });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to load domain stats' });
  }
});

app.get('/api/metrics/alerts', authMiddleware, async (_req, res) => {
  try {
    const domains = await getDomainStats();
    return res.json({ ok: true, alerts: getAlerts(domains) });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to load alerts' });
  }
});

app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DMARC API server listening on ${PORT}`);
});
