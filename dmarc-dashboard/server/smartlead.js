import { Router } from 'express';

const router = Router();
const SL_BASE = 'https://server.smartlead.ai/api/v1';
const SL_KEY = () => process.env.SMARTLEAD_API_KEY || '';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGES = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 90 * 60 * 1000; // 90 minutes

const _cache = new Map();    // key → { data, exp }
const _inflight = new Map(); // key → Promise

function srvCached(key, fetcher) {
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.exp) return Promise.resolve(hit.data);
  if (_inflight.has(key)) return _inflight.get(key);
  const p = fetcher()
    .then((data) => { _cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS }); _inflight.delete(key); return data; })
    .catch((err) => { _inflight.delete(key); throw err; });
  _inflight.set(key, p);
  return p;
}

function _redactKey(str) {
  const key = SL_KEY();
  return key ? str.replaceAll(key, '***') : str;
}

async function _slFetch(path, opts = {}, _attempt = 0) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${SL_BASE}${path}${sep}api_key=${SL_KEY()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`Smartlead ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } catch (err) {
    const redacted = _redactKey(err.message || '');
    const wrappedErr = redacted !== err.message ? Object.assign(new Error(redacted), { status: err.status, name: err.name }) : err;
    const retryable = wrappedErr.name === 'AbortError' || wrappedErr.status === 429 || (wrappedErr.status >= 500 && wrappedErr.status <= 599);
    if (_attempt < 2 && retryable) {
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, wrappedErr.status === 429 ? 2000 : 1000));
      return _slFetch(path, opts, _attempt + 1);
    }
    throw wrappedErr;
  } finally {
    clearTimeout(timer);
  }
}

// GET requests are cached; POST/mutations bypass the cache
function slFetch(path, opts = {}) {
  if (!opts.method || opts.method === 'GET') {
    return srvCached(path, () => _slFetch(path, opts));
  }
  return _slFetch(path, opts);
}

// Split a date range into ≤30-day chunks (Smartlead health API limit).
function _chunkDates(start, end) {
  const chunks = [];
  let cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    const chunkEnd = new Date(Math.min(cur.getTime() + 29 * 86_400_000, last.getTime()));
    chunks.push({ start: cur.toISOString().slice(0, 10), end: chunkEnd.toISOString().slice(0, 10) });
    cur = new Date(chunkEnd.getTime() + 86_400_000);
  }
  return chunks;
}

// Fetch all pages of a paginated endpoint and cache the full combined result
// under a single key (baseKey) so partial expiry can't yield inconsistent data.
async function _fetchAllPages(baseKey, pathFn, extractFn, pageSize = 100) {
  return srvCached(baseKey, async () => {
    const all = [];
    let offset = 0;
    let pageCount = 0;
    while (pageCount++ < MAX_PAGES) {
      const raw = await _slFetch(pathFn(offset, pageSize));
      const page = extractFn(raw);
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  });
}

function dateParams(req, res) {
  const end = req.query.end_date || new Date().toISOString().slice(0, 10);
  const start = req.query.start_date || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  if ((req.query.start_date && !DATE_RE.test(req.query.start_date)) ||
      (req.query.end_date && !DATE_RE.test(req.query.end_date))) {
    res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    return null;
  }
  return { start_date: start, end_date: end };
}

function validPositiveInt(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function num(v) { return typeof v === 'string' ? Number(v) || 0 : v || 0; }

// ── Reply Intelligence ──────────────────────────────────────────────────────

router.get('/reply-categories', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const data = await srvCached(`reply-categories:${start_date}:${end_date}`, async () => {
      const chunks = _chunkDates(start_date, end_date);
      const byName = new Map();
      const chunkResults = await Promise.all(chunks.map(({ start, end }) =>
        _slFetch(`/analytics/lead/category-wise-response?start_date=${start}&end_date=${end}`)
      ));
      for (const raw of chunkResults) {
        const groups = raw?.data?.lead_responses_by_category?.leadResponseGrouping || [];
        for (const g of groups) {
          const key = (g.name || '').toLowerCase();
          if (!byName.has(key)) byName.set(key, { name: g.name, total_response: 0, sentiment_type: g.sentiment_type });
          byName.get(key).total_response += num(g.total_response);
        }
      }
      const all = [...byName.values()];
      const grandTotal = all.reduce((s, g) => s + g.total_response, 0);
      return all.map((g) => ({
        name: g.name,
        total_response: g.total_response,
        sentiment_type: g.sentiment_type,
        percentage: grandTotal > 0 ? Math.round((g.total_response / grandTotal) * 10000) / 100 : 0,
      }));
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[reply-categories]', err.message);
    res.status(500).json({ error: 'Failed to load reply categories' });
  }
});

router.get('/daily-stats', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const data = await srvCached(`daily-stats:${start_date}:${end_date}`, async () => {
      const chunks = _chunkDates(start_date, end_date);
      const byDate = new Map();
      const chunkResults = await Promise.all(chunks.map(({ start, end }) =>
        _slFetch(`/analytics/day-wise-overall-stats?start_date=${start}&end_date=${end}`)
      ));
      for (const raw of chunkResults) {
        for (const d of raw?.data?.day_wise_stats || []) {
          const key = d.date;
          if (!byDate.has(key)) byDate.set(key, { date: d.date, day_name: d.day_name, sent: 0, opened: 0, replied: 0, bounced: 0, unsubscribed: 0 });
          const acc = byDate.get(key);
          acc.sent += num(d.email_engagement_metrics?.sent);
          acc.opened += num(d.email_engagement_metrics?.opened);
          acc.replied += num(d.email_engagement_metrics?.replied);
          acc.bounced += num(d.email_engagement_metrics?.bounced);
          acc.unsubscribed += num(d.email_engagement_metrics?.unsubscribed);
        }
      }
      return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[daily-stats]', err.message);
    res.status(500).json({ error: 'Failed to load daily stats' });
  }
});

router.get('/daily-positive-replies', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const data = await srvCached(`daily-positive-replies:${start_date}:${end_date}`, async () => {
      const chunks = _chunkDates(start_date, end_date);
      const byDate = new Map();
      const chunkResults = await Promise.all(chunks.map(({ start, end }) =>
        _slFetch(`/analytics/day-wise-positive-reply-stats?start_date=${start}&end_date=${end}`)
      ));
      for (const raw of chunkResults) {
        for (const d of raw?.data?.day_wise_stats || []) {
          const key = d.date;
          if (!byDate.has(key)) byDate.set(key, { date: d.date, day_name: d.day_name, positive_replies: 0 });
          byDate.get(key).positive_replies += num(d.email_engagement_metrics?.positive_replied);
        }
      }
      return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[daily-positive-replies]', err.message);
    res.status(500).json({ error: 'Failed to load daily positive replies' });
  }
});

router.get('/response-stats', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const data = await srvCached(`response-stats:${start_date}:${end_date}`, async () => {
      const chunks = _chunkDates(start_date, end_date);
      const byId = new Map();   // campaign_id → merged response stats
      const sentById = new Map(); // campaign_id → total sent

      const chunkResults = await Promise.all(chunks.map(({ start, end }) =>
        Promise.allSettled([
          _slFetch(`/analytics/campaign/response-stats?start_date=${start}&end_date=${end}&full_data=true`),
          _slFetch(`/analytics/campaign/overall-stats?start_date=${start}&end_date=${end}&full_data=true&limit=200&offset=0`),
        ])
      ));
      for (const [respResult, campResult] of chunkResults) {
        const campRaw = campResult.status === 'fulfilled' ? campResult.value : null;
        const respRaw = respResult.status === 'fulfilled' ? respResult.value : null;
        if (campResult.status === 'rejected') console.warn('[response-stats] overall-stats chunk failed:', campResult.reason?.message);
        if (respResult.status === 'rejected') console.warn('[response-stats] response-stats chunk failed:', respResult.reason?.message);
        for (const c of campRaw?.data?.campaign_wise_performance || []) {
          const id = String(c.id);
          sentById.set(id, (sentById.get(id) || 0) + num(c.sent));
        }
        for (const c of respRaw?.data?.campaign_wise_response_stats || []) {
          const id = String(c.email_campaign_id);
          if (!byId.has(id)) byId.set(id, { campaign_id: c.email_campaign_id, campaign_name: c.email_campaign_name, total_replies: 0, positive_replies: 0, negative_replies: 0, neutral_replies: 0 });
          const acc = byId.get(id);
          acc.total_replies += num(c.total_response);
          acc.positive_replies += num(c.total_positive_response);
          acc.negative_replies += num(c.total_negative_response);
          acc.neutral_replies += num(c.total_neutral_response);
        }
      }
      return [...byId.values()].map((c) => {
        const sent = sentById.get(String(c.campaign_id)) || 0;
        return {
          campaign_id: c.campaign_id,
          campaign_name: c.campaign_name,
          total_sent: sent,
          total_replies: c.total_replies,
          positive_replies: c.positive_replies,
          negative_replies: c.negative_replies,
          neutral_replies: c.neutral_replies,
          reply_rate: sent > 0 ? Math.round((c.total_replies / sent) * 10000) / 100 : 0,
        };
      });
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[response-stats]', err.message);
    res.status(500).json({ error: 'Failed to load response stats' });
  }
});

// ── Mailbox Health ──────────────────────────────────────────────────────────

router.get('/mailbox-health', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const data = await srvCached(`mailbox-health:${start_date}:${end_date}`, async () => {
      const chunks = _chunkDates(start_date, end_date);
      const byEmail = new Map();
      const chunkPages = await Promise.all(chunks.map(({ start, end }) =>
        _fetchAllPages(
          `mailbox-health:${start}:${end}`,
          (offset, limit) => `/analytics/mailbox/name-wise-health-metrics?start_date=${start}&end_date=${end}&full_data=true&limit=${limit}&offset=${offset}`,
          (raw) => raw?.data?.email_health_metrics || [],
        )
      ));
      for (const page of chunkPages) {
        for (const m of page) {
          const key = (m.from_email || '').toLowerCase();
          if (!byEmail.has(key)) byEmail.set(key, { from_email: m.from_email, sent: 0, opened: 0, replied: 0, positive_replied: 0, bounced: 0 });
          const acc = byEmail.get(key);
          acc.sent += num(m.sent); acc.opened += num(m.opened);
          acc.replied += num(m.replied); acc.positive_replied += num(m.positive_replied);
          acc.bounced += num(m.bounced);
        }
      }
      return [...byEmail.values()].map((m) => ({
        from_email: m.from_email,
        sent: m.sent, opened: m.opened, replied: m.replied,
        positive_replied: m.positive_replied, bounced: m.bounced,
        reply_rate: m.sent > 0 ? Math.round((m.replied / m.sent) * 10000) / 100 : 0,
        bounce_rate: m.sent > 0 ? Math.round((m.bounced / m.sent) * 10000) / 100 : 0,
        open_rate: m.sent > 0 ? Math.round((m.opened / m.sent) * 10000) / 100 : 0,
      }));
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[mailbox-health]', err.message);
    res.status(500).json({ error: 'Failed to load mailbox health' });
  }
});

router.get('/domain-health', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const data = await srvCached(`domain-health:${start_date}:${end_date}`, async () => {
      const chunks = _chunkDates(start_date, end_date);
      const byDomain = new Map();
      const chunkPages = await Promise.all(chunks.map(({ start, end }) =>
        _fetchAllPages(
          `domain-health:${start}:${end}`,
          (offset, limit) => `/analytics/mailbox/domain-wise-health-metrics?start_date=${start}&end_date=${end}&full_data=true&limit=${limit}&offset=${offset}`,
          (raw) => raw?.data?.domain_health_metrics || [],
        )
      ));
      for (const page of chunkPages) {
        for (const d of page) {
          const key = (d.domain || '').toLowerCase();
          if (!byDomain.has(key)) byDomain.set(key, { domain: d.domain, sent: 0, opened: 0, replied: 0, bounced: 0 });
          const acc = byDomain.get(key);
          acc.sent += num(d.sent); acc.opened += num(d.opened);
          acc.replied += num(d.replied); acc.bounced += num(d.bounced);
        }
      }
      return [...byDomain.values()].map((d) => ({
        domain: d.domain,
        sent: d.sent, opened: d.opened, replied: d.replied, bounced: d.bounced,
        reply_rate: d.sent > 0 ? Math.round((d.replied / d.sent) * 10000) / 100 : 0,
        bounce_rate: d.sent > 0 ? Math.round((d.bounced / d.sent) * 10000) / 100 : 0,
      }));
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[domain-health]', err.message);
    res.status(500).json({ error: 'Failed to load domain health' });
  }
});

router.get('/provider-stats', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const raw = await slFetch(
      `/analytics/mailbox/provider-wise-overall-performance?start_date=${start_date}&end_date=${end_date}&full_data=true`
    );
    const overall = raw?.data?.email_providers_performance_overview?.overall || [];
    res.json({ ok: true, data: overall.map((p) => ({
      email_provider: p.email_provider,
      sent: num(p.sent),
      opened: num(p.opened),
      replied: num(p.replied),
      bounced: num(p.bounced),
      reply_rate: parseFloat(p.reply_rate) || 0,
      bounce_rate: parseFloat(p.bounce_rate) || 0,
    })) });
  } catch (err) {
    console.error('[provider-stats]', err.message);
    res.status(500).json({ error: 'Failed to load provider stats' });
  }
});

router.get('/mailbox-overall', async (req, res) => {
  try {
    const raw = await slFetch('/analytics/mailbox/overall-stats');
    res.json({ ok: true, data: raw?.data || {} });
  } catch (err) {
    console.error('[mailbox-overall]', err.message);
    res.status(500).json({ error: 'Failed to load mailbox overall stats' });
  }
});

router.get('/email-accounts', async (req, res) => {
  try {
    const all = await _fetchAllPages(
      'email-accounts',
      (offset, limit) => `/email-accounts?limit=${limit}&offset=${offset}`,
      (raw) => (Array.isArray(raw) ? raw : raw?.data || []),
    );
    res.json({ ok: true, data: all.map((a) => ({
      id: a.id,
      from_email: a.from_email,
      is_smtp_success: a.is_smtp_success,
      is_imap_success: a.is_imap_success,
      type: a.type,
      daily_sent_count: num(a.daily_sent_count),
      message_per_day: num(a.message_per_day),
      warmup_enabled: a.warmup_details?.warmup_enabled || false,
    })) });
  } catch (err) {
    console.error('[email-accounts]', err.message);
    res.status(500).json({ error: 'Failed to load email accounts' });
  }
});

// ── Campaign Funnel ─────────────────────────────────────────────────────────

router.get('/campaign-stats', async (req, res) => {
  try {
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const data = await srvCached(`campaign-stats:${start_date}:${end_date}`, async () => {
      const chunks = _chunkDates(start_date, end_date);
      const byId = new Map();

      // Fetch campaign metadata once (no date range)
      const metaRaw = await _slFetch('/analytics/campaign/list');
      const statusMap = {};
      for (const camp of metaRaw?.data?.campaign_list || []) {
        statusMap[String(camp.id)] = camp.status || '';
      }

      const chunkPages = await Promise.all(chunks.map(({ start, end }) =>
        _fetchAllPages(
          `campaign-stats-chunk:${start}:${end}`,
          (offset, limit) => `/analytics/campaign/overall-stats?start_date=${start}&end_date=${end}&full_data=true&limit=${limit}&offset=${offset}`,
          (raw) => raw?.data?.campaign_wise_performance || [],
        )
      ));
      for (const page of chunkPages) {
        for (const c of page) {
          const id = String(c.id);
          if (!byId.has(id)) byId.set(id, { id: c.id, campaign_name: c.campaign_name, sent: 0, opened: 0, replied: 0, bounced: 0, positive_replied: 0 });
          const acc = byId.get(id);
          acc.sent += num(c.sent); acc.opened += num(c.opened);
          acc.replied += num(c.replied); acc.bounced += num(c.bounced);
          acc.positive_replied += num(c.positive_replied);
        }
      }

      return [...byId.values()].map((c) => ({
        campaign_id: c.id,
        campaign_name: c.campaign_name,
        status: (statusMap[String(c.id)] || '').toUpperCase(),
        sent: c.sent,
        opened: c.opened,
        replied: c.replied,
        bounced: c.bounced,
        positive_replied: c.positive_replied,
        open_rate: c.sent > 0 ? Math.round((c.opened / c.sent) * 10000) / 100 : 0,
        reply_rate: c.sent > 0 ? Math.round((c.replied / c.sent) * 10000) / 100 : 0,
        bounce_rate: c.sent > 0 ? Math.round((c.bounced / c.sent) * 10000) / 100 : 0,
        positive_reply_rate: c.sent > 0 ? Math.round((c.positive_replied / c.sent) * 10000) / 100 : 0,
      }));
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[campaign-stats]', err.message);
    res.status(500).json({ error: 'Failed to load campaign stats' });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    const raw = await slFetch('/analytics/campaign/list');
    const list = raw?.data?.campaign_list || [];
    res.json({ ok: true, data: list });
  } catch (err) {
    console.error('[campaigns]', err.message);
    res.status(500).json({ error: 'Failed to load campaigns' });
  }
});

// ── Sequence Performance ────────────────────────────────────────────────────

router.get('/sequence-analytics/:campaignId', async (req, res) => {
  try {
    const id = validPositiveInt(req.params.campaignId);
    if (!id) return res.status(400).json({ error: 'Invalid campaign ID' });
    const dates = dateParams(req, res);
    if (!dates) return;
    const { start_date, end_date } = dates;
    const raw = await slFetch(
      `/campaigns/${id}/sequence-analytics?start_date=${start_date}&end_date=${end_date}`
    );
    const seqs = Array.isArray(raw?.data) ? raw.data : raw?.data?.sequence_analytics || [];
    res.json({ ok: true, data: seqs });
  } catch (err) {
    console.error('[sequence-analytics]', err.message);
    res.status(500).json({ error: 'Failed to load sequence analytics' });
  }
});

router.get('/campaign-sequences/:campaignId', async (req, res) => {
  try {
    const id = validPositiveInt(req.params.campaignId);
    if (!id) return res.status(400).json({ error: 'Invalid campaign ID' });
    const raw = await slFetch(`/campaigns/${id}/sequences`);
    res.json({ ok: true, data: raw?.data || [] });
  } catch (err) {
    console.error('[campaign-sequences]', err.message);
    res.status(500).json({ error: 'Failed to load campaign sequences' });
  }
});

// ── Inbox Replies ───────────────────────────────────────────────────────────

router.post('/inbox-replies', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    const allowed = ['offset', 'limit', 'campaign_id', 'lead_category_id', 'message_type'];
    const filtered = {};
    for (const key of allowed) {
      if (body[key] !== undefined) filtered[key] = body[key];
    }
    const raw = await slFetch('/master-inbox/inbox-replies', {
      method: 'POST',
      body: filtered,
    });
    res.json({ ok: true, data: raw?.data || [] });
  } catch (err) {
    console.error('[inbox-replies]', err.message);
    res.status(500).json({ error: 'Failed to load inbox replies' });
  }
});

export default router;

// ── Shared fetch helpers (used by sender-health route in index.js) ───────────

export async function fetchDomainHealthForRange(startDate, endDate) {
  const chunks = _chunkDates(startDate, endDate);
  const byDomain = new Map();
  const chunkPages = await Promise.all(chunks.map(({ start, end }) =>
    _fetchAllPages(
      `domain-health:${start}:${end}`,
      (offset, limit) => `/analytics/mailbox/domain-wise-health-metrics?start_date=${start}&end_date=${end}&full_data=true&limit=${limit}&offset=${offset}`,
      (raw) => raw?.data?.domain_health_metrics || [],
    )
  ));
  for (const page of chunkPages) {
    for (const d of page) {
      const key = (d.domain || '').toLowerCase();
      if (!byDomain.has(key)) byDomain.set(key, { domain: d.domain, sent: 0, opened: 0, replied: 0, positive_replied: 0, bounced: 0 });
      const acc = byDomain.get(key);
      acc.sent += num(d.sent); acc.opened += num(d.opened);
      acc.replied += num(d.replied); acc.positive_replied += num(d.positive_replied);
      acc.bounced += num(d.bounced);
    }
  }
  return [...byDomain.values()].map((d) => ({
    domain: d.domain,
    sent_count: d.sent,
    reply_rate: d.sent > 0 ? Math.round((d.replied / d.sent) * 10000) / 100 : 0,
    bounce_rate: d.sent > 0 ? Math.round((d.bounced / d.sent) * 10000) / 100 : 0,
    open_rate: d.sent > 0 ? Math.round((d.opened / d.sent) * 10000) / 100 : 0,
    positive_reply_rate: d.sent > 0 ? Math.round((d.positive_replied / d.sent) * 10000) / 100 : 0,
  }));
}

export async function fetchMailboxHealthForRange(startDate, endDate) {
  const chunks = _chunkDates(startDate, endDate);
  const byEmail = new Map();
  const chunkPages = await Promise.all(chunks.map(({ start, end }) =>
    _fetchAllPages(
      `mailbox-health:${start}:${end}`,
      (offset, limit) => `/analytics/mailbox/name-wise-health-metrics?start_date=${start}&end_date=${end}&full_data=true&limit=${limit}&offset=${offset}`,
      (raw) => raw?.data?.email_health_metrics || [],
    )
  ));
  for (const page of chunkPages) {
    for (const m of page) {
      const key = (m.from_email || '').toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, { from_email: m.from_email, sent: 0, bounced: 0, inbox_pct: 0, spam_pct: 0, _count: 0 });
      const acc = byEmail.get(key);
      acc.sent += num(m.sent); acc.bounced += num(m.bounced);
      acc.inbox_pct += num(m.inbox_percentage || m.inbox_pct || 0);
      acc.spam_pct += num(m.spam_percentage || m.spam_pct || 0);
      acc._count += 1;
    }
  }
  return [...byEmail.values()].map((m) => ({
    from_email: m.from_email,
    sent_count: m.sent,
    bounce_rate: m.sent > 0 ? Math.round((m.bounced / m.sent) * 10000) / 100 : 0,
    inbox_pct: m._count > 0 ? Math.round((m.inbox_pct / m._count) * 10) / 10 : 0,
    spam_pct: m._count > 0 ? Math.round((m.spam_pct / m._count) * 10) / 10 : 0,
  }));
}
