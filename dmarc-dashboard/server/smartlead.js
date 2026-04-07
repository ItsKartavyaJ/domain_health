import { Router } from 'express';

const router = Router();
const SL_BASE = 'https://server.smartlead.ai/api/v1';
const SL_KEY = () => process.env.SMARTLEAD_API_KEY || '';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGES = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function slFetch(path, opts = {}) {
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
      throw new Error(`Smartlead ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
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
    const raw = await slFetch(
      `/analytics/lead/category-wise-response?start_date=${start_date}&end_date=${end_date}`
    );
    const groups = raw?.data?.lead_responses_by_category?.leadResponseGrouping || [];
    res.json({ ok: true, data: groups.map((g) => ({
      name: g.name,
      total_response: num(g.total_response),
      sentiment_type: g.sentiment_type,
      percentage: parseFloat(g.percentage) || 0,
    })) });
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
    const raw = await slFetch(
      `/analytics/day-wise-overall-stats?start_date=${start_date}&end_date=${end_date}`
    );
    const stats = raw?.data?.day_wise_stats || [];
    res.json({ ok: true, data: stats.map((d) => ({
      date: d.date,
      day_name: d.day_name,
      sent: num(d.email_engagement_metrics?.sent),
      opened: num(d.email_engagement_metrics?.opened),
      replied: num(d.email_engagement_metrics?.replied),
      bounced: num(d.email_engagement_metrics?.bounced),
      unsubscribed: num(d.email_engagement_metrics?.unsubscribed),
    })) });
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
    const raw = await slFetch(
      `/analytics/day-wise-positive-reply-stats?start_date=${start_date}&end_date=${end_date}`
    );
    const stats = raw?.data?.day_wise_stats || [];
    res.json({ ok: true, data: stats.map((d) => ({
      date: d.date,
      day_name: d.day_name,
      positive_replies: num(d.email_engagement_metrics?.positive_replied),
    })) });
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
    const [respRaw, campRaw] = await Promise.all([
      slFetch(`/analytics/campaign/response-stats?start_date=${start_date}&end_date=${end_date}&full_data=true`),
      slFetch(`/analytics/campaign/overall-stats?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=200&offset=0`),
    ]);
    const stats = respRaw?.data?.campaign_wise_response_stats || [];
    const campaigns = campRaw?.data?.campaign_wise_performance || [];
    const sentMap = {};
    for (const c of campaigns) {
      sentMap[String(c.id)] = num(c.sent);
    }
    res.json({ ok: true, data: stats.map((c) => {
      const actualSent = sentMap[String(c.email_campaign_id)] || 0;
      return {
        campaign_id: c.email_campaign_id,
        campaign_name: c.email_campaign_name,
        total_sent: actualSent,
        total_replies: num(c.total_response),
        positive_replies: num(c.total_positive_response),
        negative_replies: num(c.total_negative_response),
        neutral_replies: num(c.total_neutral_response),
        reply_rate: actualSent > 0 ? Math.round((num(c.total_response) / actualSent) * 10000) / 100 : 0,
      };
    }) });
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
    const all = [];
    let offset = 0;
    const pageSize = 100;
    let pageCount = 0;
    while (pageCount++ < MAX_PAGES) {
      const raw = await slFetch(
        `/analytics/mailbox/name-wise-health-metrics?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=${pageSize}&offset=${offset}`
      );
      const page = raw?.data?.email_health_metrics || [];
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    res.json({ ok: true, data: all.map((m) => ({
      from_email: m.from_email,
      sent: num(m.sent),
      opened: num(m.opened),
      replied: num(m.replied),
      positive_replied: num(m.positive_replied),
      bounced: num(m.bounced),
      reply_rate: parseFloat(m.reply_rate) || 0,
      bounce_rate: parseFloat(m.bounce_rate) || 0,
      open_rate: parseFloat(m.open_rate) || 0,
    })) });
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
    const all = [];
    let offset = 0;
    const pageSize = 100;
    let pageCount = 0;
    while (pageCount++ < MAX_PAGES) {
      const raw = await slFetch(
        `/analytics/mailbox/domain-wise-health-metrics?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=${pageSize}&offset=${offset}`
      );
      const metrics = raw?.data?.domain_health_metrics || [];
      all.push(...metrics);
      if (metrics.length < pageSize) break;
      offset += pageSize;
    }
    res.json({ ok: true, data: all.map((d) => ({
      domain: d.domain,
      sent: num(d.sent),
      opened: num(d.opened),
      replied: num(d.replied),
      bounced: num(d.bounced),
      reply_rate: parseFloat(d.reply_rate) || 0,
      bounce_rate: parseFloat(d.bounce_rate) || 0,
    })) });
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
    const all = [];
    let offset = 0;
    const pageSize = 100;
    let pageCount = 0;
    while (pageCount++ < MAX_PAGES) {
      const raw = await slFetch(`/email-accounts?limit=${pageSize}&offset=${offset}`);
      const page = Array.isArray(raw) ? raw : raw?.data || [];
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
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
    const all = [];
    let offset = 0;
    const pageSize = 100;
    let pageCount = 0;
    while (pageCount++ < MAX_PAGES) {
      const raw = await slFetch(
        `/analytics/campaign/overall-stats?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=${pageSize}&offset=${offset}`
      );
      const campaigns = raw?.data?.campaign_wise_performance || [];
      all.push(...campaigns);
      if (campaigns.length < pageSize) break;
      offset += pageSize;
    }
    res.json({ ok: true, data: all.map((c) => ({
      campaign_id: c.id,
      campaign_name: c.campaign_name,
      sent: num(c.sent),
      opened: num(c.opened),
      replied: num(c.replied),
      bounced: num(c.bounced),
      positive_replied: num(c.positive_replied),
      open_rate: parseFloat(c.open_rate) || 0,
      reply_rate: parseFloat(c.reply_rate) || 0,
      bounce_rate: parseFloat(c.bounce_rate) || 0,
      positive_reply_rate: parseFloat(c.positive_reply_rate) || 0,
    })) });
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
