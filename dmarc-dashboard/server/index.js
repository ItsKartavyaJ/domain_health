import dotenv from 'dotenv';
import express from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import path from 'path';
import { fileURLToPath } from 'url';
import smartleadRouter from './smartlead.js';

dotenv.config();

const PORT = Number(process.env.API_PORT || 8787);
// Accept both INFLUXDB_* (canonical) and INFLUX_* (legacy) prefixes so a single
// set of vars in .env works for all three stack components.
const INFLUX_URL = process.env.INFLUXDB_URL || process.env.INFLUX_URL || '';
const INFLUX_ORG = process.env.INFLUXDB_ORG || process.env.INFLUX_ORG || 'pintel';
const INFLUX_BUCKET = process.env.INFLUXDB_DMARC_BUCKET || process.env.INFLUX_BUCKET || 'dmarc';
const INFLUX_DELIVERABILITY_BUCKET = process.env.INFLUXDB_BUCKET || 'deliverability';
const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN || process.env.INFLUX_TOKEN || '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'pintel.ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

if (!INFLUX_URL || !INFLUX_TOKEN) {
  throw new Error('Missing InfluxDB URL/token — set INFLUXDB_URL + INFLUXDB_TOKEN (or legacy INFLUX_URL + INFLUX_TOKEN)');
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

// Simple in-memory rate limiter: max 60 requests per user per minute
const _rateBuckets = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

function rateLimitMiddleware(req, res, next) {
  const key = req.user;
  const now = Date.now();
  let bucket = _rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    _rateBuckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

// Prune stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of _rateBuckets) {
    if (now > bucket.resetAt) _rateBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (!decoded.email || !decoded.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      return res.status(403).json({ error: `Access restricted to @${ALLOWED_DOMAIN} accounts` });
    }
    req.user = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(csvText) {
  const lines = csvText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
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

class InfluxError extends Error {
  constructor(status, body) {
    super(`Influx query failed (${status}): ${body}`);
    this.status = status;
  }
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
    throw new InfluxError(response.status, body);
  }

  return parseCsv(await response.text());
}

const DOMAIN_STATS_TTL = 90 * 60 * 1000;
let _domainStatsCache = null;
let _domainStatsCachedAt = 0;
let _domainStatsInflight = null;
let _domainStatsGen = 0;  // incremented on refresh so stale inflights don't overwrite

async function getDomainStats() {
  if (_domainStatsCache && Date.now() - _domainStatsCachedAt < DOMAIN_STATS_TTL) {
    return _domainStatsCache;
  }
  if (_domainStatsInflight) return _domainStatsInflight;

  const gen = _domainStatsGen;
  _domainStatsInflight = _fetchDomainStats().then((result) => {
    if (_domainStatsGen === gen) {
      _domainStatsCache = result;
      _domainStatsCachedAt = Date.now();
    }
    _domainStatsInflight = null;
    return result;
  }).catch((err) => {
    _domainStatsInflight = null;
    throw err;
  });
  return _domainStatsInflight;
}

async function _fetchDomainStats() {
  let rows;
  try {
    rows = await queryFlux(`
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "dmarc_aggregate")
  |> filter(fn: (r) => r._field == "message_count" or r._field == "passed_dmarc" or r._field == "spf_aligned" or r._field == "dkim_aligned")
  |> map(fn: (r) => ({
      _time: r._time,
      _measurement: r._measurement,
      header_from: r.header_from,
      _field: r._field,
      _value: string(v: r._value),
    }))
  |> group(columns: ["_measurement", "header_from"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> group(columns: ["header_from"])
  |> reduce(
      identity: {header_from: "", total: 0.0, passed: 0.0, spf_aligned_count: 0.0, dkim_aligned_count: 0.0},
      fn: (r, accumulator) => ({
        header_from: r.header_from,
        total: accumulator.total + (if exists r.message_count then float(v: r.message_count) else 0.0),
        passed: accumulator.passed + (if exists r.passed_dmarc and r.passed_dmarc == "true" and exists r.message_count then float(v: r.message_count) else 0.0),
        spf_aligned_count: accumulator.spf_aligned_count + (if exists r.spf_aligned and r.spf_aligned == "true" and exists r.message_count then float(v: r.message_count) else 0.0),
        dkim_aligned_count: accumulator.dkim_aligned_count + (if exists r.dkim_aligned and r.dkim_aligned == "true" and exists r.message_count then float(v: r.message_count) else 0.0),
      })
    )
  |> keep(columns: ["header_from", "total", "passed", "spf_aligned_count", "dkim_aligned_count"])
  |> sort(columns: ["total"], desc: true)
  |> limit(n: 1000)
`);
  } catch (err) {
    // Bucket empty or no dmarc_aggregate data yet — return empty
    if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
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
        status: (() => {
          const spf = spfRate > 95 ? 'Pass' : spfRate > 70 ? 'Partial' : 'Fail';
          const dkim = dkimRate > 95 ? 'Pass' : 'Fail';
          if (dkim === 'Fail' || rate <= 50) return 'err';
          if (spf !== 'Pass' || rate <= 80) return 'warn';
          return 'ok';
        })(),
      };
    });
}

function getAlerts(domains) {
  const ORDER = { red: 0, amber: 1, green: 2 };
  return domains
    .map((d) => {
      if (d.dkim === 'Fail') {
        return {
          type: 'red',
          domain: d.domain,
          message: `${d.domain} — DKIM not configured`,
          desc: 'Emails are sent without a DKIM signature. Add a DKIM TXT record in your DNS provider to authenticate outbound mail.',
        };
      }
      if (d.rate < 50) {
        return {
          type: 'red',
          domain: d.domain,
          message: `${d.domain} — ${100 - d.rate}% of emails failing DMARC`,
          desc: 'More than half of emails from this domain are failing DMARC. Gmail and Outlook may block or quarantine them.',
        };
      }
      if (d.spf === 'Fail') {
        return {
          type: 'red',
          domain: d.domain,
          message: `${d.domain} — No SPF record found`,
          desc: 'SPF record is missing or invalid. Add a DNS TXT record: v=spf1 include:your-mail-provider.com ~all',
        };
      }
      if (d.spf === 'Partial') {
        return {
          type: 'amber',
          domain: d.domain,
          message: `${d.domain} — SPF record is incomplete`,
          desc: 'Some sending IPs are not covered. Review which mail servers send on behalf of this domain and update the SPF record.',
        };
      }
      if (d.rate <= 80) {
        return {
          type: 'amber',
          domain: d.domain,
          message: `${d.domain} — DMARC pass rate at ${d.rate}%`,
          desc: 'Below 80% — Google may throttle delivery from this domain. Check SPF and DKIM alignment in your mail platform.',
        };
      }
      return {
        type: 'green',
        domain: d.domain,
        message: `${d.domain} — All checks passed`,
        desc: 'SPF, DKIM and DMARC are all aligned and passing.',
      };
    })
    .sort((a, b) => (ORDER[a.type] ?? 3) - (ORDER[b.type] ?? 3))
    .slice(0, 8);
}

app.get('/api/auth/me', authMiddleware, rateLimitMiddleware, (req, res) => {
  return res.json({ ok: true, user: req.user });
});

app.get('/api/metrics/domain-stats', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    const domains = await getDomainStats();
    return res.json({ ok: true, domains });
  } catch (err) {
    console.error('[domain-stats]', err.message);
    return res.status(500).json({ error: 'Failed to load domain stats' });
  }
});

app.get('/api/metrics/alerts', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    const domains = await getDomainStats();
    return res.json({ ok: true, alerts: getAlerts(domains) });
  } catch {
    return res.status(500).json({ error: 'Failed to load alerts' });
  }
});

app.get('/api/metrics/spf-gaps', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    let rows;
    try {
      rows = await queryFlux(`
from(bucket: "${INFLUX_DELIVERABILITY_BUCKET}")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "spf_ip_validation")
  |> filter(fn: (r) => r._field == "authorized")
  |> group(columns: ["domain", "ip"])
  |> last()
  |> filter(fn: (r) => r._value == "0" or r._value == 0)
`);
    } catch (err) {
      if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
        return res.json({ ok: true, gaps: {} });
      }
      throw err;
    }
    const gaps = {};
    for (const r of rows) {
      if (r.domain && r.ip) {
        if (!gaps[r.domain]) gaps[r.domain] = [];
        if (!gaps[r.domain].includes(r.ip)) gaps[r.domain].push(r.ip);
      }
    }
    return res.json({ ok: true, gaps });
  } catch (err) {
    console.error('[spf-gaps]', err.message);
    return res.status(500).json({ error: 'Failed to load SPF gaps' });
  }
});

app.post('/api/metrics/refresh', authMiddleware, rateLimitMiddleware, (_req, res) => {
  _domainStatsGen++;          // invalidate any in-flight query result
  _domainStatsCache = null;
  _domainStatsCachedAt = 0;
  _domainStatsInflight = null;
  return res.json({ ok: true });
});

app.get('/api/metrics/blacklist-status', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    let rows;
    try {
      rows = await queryFlux(`
from(bucket: "${INFLUX_DELIVERABILITY_BUCKET}")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "rbl_check")
  |> filter(fn: (r) => r._field == "blacklisted" or r._field == "list_count" or r._field == "detected_by")
  |> map(fn: (r) => ({
      _time: r._time,
      _measurement: r._measurement,
      domain: r.domain,
      check_type: r.check_type,
      _field: r._field,
      _value: string(v: r._value),
    }))
  |> group(columns: ["_measurement", "domain", "check_type", "_field"])
  |> last()
  |> group(columns: ["domain", "check_type"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
`);
    } catch (err) {
      if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
        return res.json({ ok: true, domains: [] });
      }
      throw err;
    }
    const domainMap = {};
    for (const r of rows) {
      if (!r.domain) continue;
      if (!domainMap[r.domain]) domainMap[r.domain] = { domain: r.domain, blacklisted: false, lists: [], listCount: 0 };
      const isBlacklisted = r.blacklisted === '1' || Number(r.blacklisted) === 1;
      if (isBlacklisted) {
        domainMap[r.domain].blacklisted = true;
        domainMap[r.domain].listCount = toNumber(r.list_count);
        if (r.detected_by) {
          const lists = r.detected_by.split(',').map((s) => s.trim()).filter(Boolean);
          for (const l of lists) {
            if (!domainMap[r.domain].lists.includes(l)) domainMap[r.domain].lists.push(l);
          }
        }
      }
    }
    const domains = Object.values(domainMap).filter((d) => d.blacklisted);
    return res.json({ ok: true, domains });
  } catch (err) {
    console.error('[blacklist-status]', err.message);
    return res.status(500).json({ error: 'Failed to load blacklist status' });
  }
});

app.get('/api/metrics/dns-status', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    let rows;
    try {
      rows = await queryFlux(`
from(bucket: "${INFLUX_DELIVERABILITY_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "dmarc_dns_check")
  |> filter(fn: (r) => r.record_type == "composite_score")
  |> filter(fn: (r) => r._field == "dmarc_policy" or r._field == "score" or r._field == "spf_valid" or r._field == "dkim_valid" or r._field == "dmarc_valid")
  |> map(fn: (r) => ({
      _time: r._time,
      _measurement: r._measurement,
      domain: r.domain,
      _field: r._field,
      _value: string(v: r._value),
    }))
  |> group(columns: ["_measurement", "domain", "_field"])
  |> last()
  |> group(columns: ["domain"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
`);
    } catch (err) {
      if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
        return res.json({ ok: true, domains: [] });
      }
      throw err;
    }
    const domains = rows
      .filter((r) => r.domain)
      .map((r) => ({
        domain: r.domain,
        dmarc_policy: r.dmarc_policy || 'none',
        score: Math.round(toNumber(r.score)),
        spf_valid: r.spf_valid === 'true',
        dkim_valid: r.dkim_valid === 'true',
        dmarc_valid: r.dmarc_valid === 'true',
      }));
    return res.json({ ok: true, domains });
  } catch (err) {
    console.error('[dns-status]', err.message);
    return res.status(500).json({ error: 'Failed to load DNS status' });
  }
});

async function _fetchRateWindow(start, stop) {
  const rangeArgs = stop ? `start: ${start}, stop: ${stop}` : `start: ${start}`;
  const rows = await queryFlux(`
from(bucket: "${INFLUX_BUCKET}")
  |> range(${rangeArgs})
  |> filter(fn: (r) => r._measurement == "dmarc_aggregate")
  |> filter(fn: (r) => r._field == "message_count" or r._field == "passed_dmarc")
  |> map(fn: (r) => ({
      _time: r._time,
      _measurement: r._measurement,
      header_from: r.header_from,
      _field: r._field,
      _value: string(v: r._value),
    }))
  |> group(columns: ["_measurement", "header_from"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> group(columns: ["header_from"])
  |> reduce(
      identity: {header_from: "", total: 0.0, passed: 0.0},
      fn: (r, accumulator) => ({
        header_from: r.header_from,
        total: accumulator.total + (if exists r.message_count then float(v: r.message_count) else 0.0),
        passed: accumulator.passed + (if exists r.passed_dmarc and r.passed_dmarc == "true" and exists r.message_count then float(v: r.message_count) else 0.0),
      })
    )
  |> keep(columns: ["header_from", "total", "passed"])
`);
  const map = {};
  for (const r of rows) {
    if (r.header_from) {
      const total = Math.round(toNumber(r.total));
      const passed = Math.round(toNumber(r.passed));
      map[r.header_from] = { total, passed, rate: total > 0 ? Math.round((passed / total) * 100) : 0 };
    }
  }
  return map;
}

app.get('/api/metrics/domain-trend', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    let current, previous;
    try {
      [current, previous] = await Promise.all([
        _fetchRateWindow('-7d'),
        _fetchRateWindow('-14d', '-7d'),
      ]);
    } catch (err) {
      if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
        return res.json({ ok: true, trends: [] });
      }
      throw err;
    }
    const domains = new Set([...Object.keys(current), ...Object.keys(previous)]);
    const trends = [];
    for (const domain of domains) {
      const cur = current[domain] || { rate: 0, total: 0 };
      const prev = previous[domain] || { rate: 0, total: 0 };
      if (cur.total === 0 && prev.total === 0) continue;
      trends.push({
        domain,
        currentRate: cur.rate,
        prevRate: prev.rate,
        delta: cur.rate - prev.rate,
      });
    }
    return res.json({ ok: true, trends });
  } catch (err) {
    console.error('[domain-trend]', err.message);
    return res.status(500).json({ error: 'Failed to load domain trend' });
  }
});

app.get('/api/metrics/warmup-summary', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    let rows;
    try {
      rows = await queryFlux(`
from(bucket: "${INFLUX_DELIVERABILITY_BUCKET}")
  |> range(start: -48h)
  |> filter(fn: (r) => r._measurement == "warmup_stats")
  |> filter(fn: (r) => r._field == "health_score" or r._field == "spam_pct" or r._field == "warmup_enabled")
  |> map(fn: (r) => ({
      _time: r._time,
      _measurement: r._measurement,
      email: r.email,
      domain: r.domain,
      _field: r._field,
      _value: string(v: r._value),
    }))
  |> group(columns: ["_measurement", "email", "domain", "_field"])
  |> last()
  |> group(columns: ["email", "domain"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
`);
    } catch (err) {
      if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
        return res.json({ ok: true, domains: [] });
      }
      throw err;
    }
    const domainMap = {};
    for (const r of rows) {
      const domain = r.domain;
      if (!domain) continue;
      if (!domainMap[domain]) domainMap[domain] = { domain, mailboxes: [] };
      domainMap[domain].mailboxes.push({
        email: r.email || '',
        health_score: toNumber(r.health_score),
        spam_pct: toNumber(r.spam_pct),
        warmup_enabled: r.warmup_enabled === '1' || Number(r.warmup_enabled) === 1,
      });
    }
    const domains = Object.values(domainMap).map((d) => {
      const enabled = d.mailboxes.filter((m) => m.warmup_enabled);
      const scored = d.mailboxes.filter((m) => m.health_score > 0);
      const avgHealth = scored.length > 0 ? Math.round(scored.reduce((s, m) => s + m.health_score, 0) / scored.length) : 0;
      const avgSpam = d.mailboxes.length > 0 ? Math.round((d.mailboxes.reduce((s, m) => s + m.spam_pct, 0) / d.mailboxes.length) * 10) / 10 : 0;
      return {
        domain: d.domain,
        total_mailboxes: d.mailboxes.length,
        enabled_count: enabled.length,
        avg_health: avgHealth,
        avg_spam_pct: avgSpam,
      };
    }).sort((a, b) => b.total_mailboxes - a.total_mailboxes);
    return res.json({ ok: true, domains });
  } catch (err) {
    console.error('[warmup-summary]', err.message);
    return res.status(500).json({ error: 'Failed to load warmup summary' });
  }
});

app.get('/api/metrics/dmarc-sources', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    let rows;
    try {
      rows = await queryFlux(`
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "dmarc_aggregate")
  |> filter(fn: (r) => r._field == "message_count")
  |> group(columns: ["header_from", "source_ip"])
  |> sum()
  |> sort(columns: ["_value"], desc: true)
  |> limit(n: 500)
`);
    } catch (err) {
      if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
        return res.json({ ok: true, sources: [] });
      }
      throw err;
    }
    const sources = rows
      .filter((r) => r.header_from && r.source_ip)
      .map((r) => ({
        domain: r.header_from,
        source_ip: r.source_ip,
        message_count: Math.round(toNumber(r._value)),
      }));
    return res.json({ ok: true, sources });
  } catch (err) {
    console.error('[dmarc-sources]', err.message);
    return res.status(500).json({ error: 'Failed to load DMARC sources' });
  }
});

app.get('/api/metrics/sender-health', authMiddleware, rateLimitMiddleware, async (_req, res) => {
  try {
    let domainRows, mailboxRows, trendRows;
    try {
      [domainRows, mailboxRows, trendRows] = await Promise.all([
        queryFlux(`
from(bucket: "${INFLUX_DELIVERABILITY_BUCKET}")
  |> range(start: -48h)
  |> filter(fn: (r) => r._measurement == "smartlead_health")
  |> filter(fn: (r) => r.grain == "domain")
  |> filter(fn: (r) => r._field == "reply_rate" or r._field == "bounce_rate" or r._field == "positive_reply_rate" or r._field == "sent_count" or r._field == "inbox_pct" or r._field == "spam_pct" or r._field == "open_rate")
  |> map(fn: (r) => ({
      _time: r._time,
      _measurement: r._measurement,
      domain: r.domain,
      _field: r._field,
      _value: string(v: r._value),
    }))
  |> group(columns: ["_measurement", "domain", "_field"])
  |> last()
  |> group(columns: ["domain"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
`),
        queryFlux(`
from(bucket: "${INFLUX_DELIVERABILITY_BUCKET}")
  |> range(start: -48h)
  |> filter(fn: (r) => r._measurement == "smartlead_health")
  |> filter(fn: (r) => r.grain == "mailbox")
  |> filter(fn: (r) => r._field == "sent_count" or r._field == "inbox_pct" or r._field == "spam_pct" or r._field == "bounce_rate" or r._field == "warmup_status" or r._field == "health_score")
  |> map(fn: (r) => ({
      _time: r._time,
      _measurement: r._measurement,
      email: r.email,
      domain: r.domain,
      _field: r._field,
      _value: string(v: r._value),
    }))
  |> group(columns: ["_measurement", "email", "domain", "_field"])
  |> last()
  |> group(columns: ["email", "domain"])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
`),
        queryFlux(`
from(bucket: "${INFLUX_DELIVERABILITY_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "smartlead_health")
  |> filter(fn: (r) => r.grain == "domain")
  |> filter(fn: (r) => r._field == "reply_rate")
  |> group(columns: ["domain"])
  |> aggregateWindow(every: 1d, fn: last, createEmpty: false)
  |> map(fn: (r) => ({domain: r.domain, _time: r._time, _value: r._value}))
`),
      ]);
    } catch (err) {
      if (err instanceof InfluxError && (err.status === 404 || err.status === 422)) {
        return res.json({ ok: true, domains: [] });
      }
      throw err;
    }

    // Build reply_rate trend map: { domain -> [v1, v2, ...] } (chronological, last 30d)
    const trendMap = {};
    for (const r of trendRows) {
      if (!r.domain) continue;
      if (!trendMap[r.domain]) trendMap[r.domain] = [];
      trendMap[r.domain].push(Math.round(toNumber(r._value) * 10) / 10);
    }

    // Build mailbox map keyed by domain
    const mailboxMap = {};
    for (const r of mailboxRows) {
      if (!r.domain || !r.email) continue;
      if (!mailboxMap[r.domain]) mailboxMap[r.domain] = [];
      mailboxMap[r.domain].push({
        email: r.email,
        sent_count: Math.round(toNumber(r.sent_count)),
        inbox_pct: Math.round(toNumber(r.inbox_pct) * 10) / 10,
        spam_pct: Math.round(toNumber(r.spam_pct) * 10) / 10,
        bounce_rate: Math.round(toNumber(r.bounce_rate) * 10) / 10,
        health_score: Math.round(toNumber(r.health_score)),
        warmup_status: r.warmup_status || 'unknown',
      });
    }

    // Build domain rows
    const domains = domainRows
      .filter((r) => r.domain)
      .map((r) => ({
        domain: r.domain,
        sent_count: Math.round(toNumber(r.sent_count)),
        reply_rate: Math.round(toNumber(r.reply_rate) * 10) / 10,
        bounce_rate: Math.round(toNumber(r.bounce_rate) * 10) / 10,
        positive_reply_rate: Math.round(toNumber(r.positive_reply_rate) * 10) / 10,
        open_rate: Math.round(toNumber(r.open_rate) * 10) / 10,
        spam_pct: Math.round(toNumber(r.spam_pct) * 10) / 10,
        inbox_pct: Math.round(toNumber(r.inbox_pct) * 10) / 10,
        reply_trend: trendMap[r.domain] || [],
        mailboxes: (mailboxMap[r.domain] || []).sort((a, b) => b.sent_count - a.sent_count),
      }))
      .sort((a, b) => b.sent_count - a.sent_count);

    return res.json({ ok: true, domains });
  } catch (err) {
    console.error('[sender-health]', err.message);
    return res.status(500).json({ error: 'Failed to load sender health' });
  }
});

app.use('/api/smartlead', authMiddleware, rateLimitMiddleware, smartleadRouter);

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
