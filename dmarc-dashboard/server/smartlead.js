import { Router } from 'express';

const router = Router();
const SL_BASE = 'https://server.smartlead.ai/api/v1';
const SL_KEY = () => process.env.SMARTLEAD_API_KEY || '';

async function slFetch(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${SL_BASE}${path}${sep}api_key=${SL_KEY()}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Smartlead ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function dateParams(req) {
  const end = req.query.end_date || new Date().toISOString().slice(0, 10);
  const start = req.query.start_date || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { start_date: start, end_date: end };
}

function num(v) { return typeof v === 'string' ? Number(v) || 0 : v || 0; }

// ── Reply Intelligence ──────────────────────────────────────────────────────

router.get('/reply-categories', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
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
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily-stats', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
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
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily-positive-replies', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
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
    res.status(500).json({ error: err.message });
  }
});

router.get('/response-stats', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const raw = await slFetch(
      `/analytics/campaign/response-stats?start_date=${start_date}&end_date=${end_date}&full_data=true`
    );
    const stats = raw?.data?.campaign_wise_response_stats || [];
    res.json({ ok: true, data: stats.map((c) => ({
      campaign_id: c.email_campaign_id,
      campaign_name: c.email_campaign_name,
      total_sent: num(c.leads_contacted),
      total_replies: num(c.total_response),
      positive_replies: num(c.total_positive_response),
      negative_replies: num(c.total_negative_response),
      neutral_replies: num(c.total_neutral_response),
      reply_rate: c.leads_contacted > 0 ? Math.round((num(c.total_response) / num(c.leads_contacted)) * 10000) / 100 : 0,
    })) });
  } catch (err) {
    console.error('[response-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Mailbox Health ──────────────────────────────────────────────────────────

router.get('/mailbox-health', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const limit = req.query.limit || '100';
    const offset = req.query.offset || '0';
    const raw = await slFetch(
      `/analytics/mailbox/name-wise-health-metrics?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=${limit}&offset=${offset}`
    );
    const metrics = raw?.data?.email_health_metrics || [];
    res.json({ ok: true, data: metrics.map((m) => ({
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
    res.status(500).json({ error: err.message });
  }
});

router.get('/domain-health', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const raw = await slFetch(
      `/analytics/mailbox/domain-wise-health-metrics?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=100&offset=0`
    );
    const metrics = raw?.data?.domain_health_metrics || [];
    res.json({ ok: true, data: metrics.map((d) => ({
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
    res.status(500).json({ error: err.message });
  }
});

router.get('/provider-stats', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
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
    res.status(500).json({ error: err.message });
  }
});

router.get('/mailbox-overall', async (req, res) => {
  try {
    const raw = await slFetch('/analytics/mailbox/overall-stats');
    res.json({ ok: true, data: raw?.data || {} });
  } catch (err) {
    console.error('[mailbox-overall]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Campaign Funnel ─────────────────────────────────────────────────────────

router.get('/campaign-stats', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const limit = req.query.limit || '50';
    const offset = req.query.offset || '0';
    const raw = await slFetch(
      `/analytics/campaign/overall-stats?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=${limit}&offset=${offset}`
    );
    const campaigns = raw?.data?.campaign_wise_performance || [];
    res.json({ ok: true, data: campaigns.map((c) => ({
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
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    const raw = await slFetch('/analytics/campaign/list');
    const list = raw?.data?.campaign_list || [];
    res.json({ ok: true, data: list });
  } catch (err) {
    console.error('[campaigns]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Sequence Performance ────────────────────────────────────────────────────

router.get('/sequence-analytics/:campaignId', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const raw = await slFetch(
      `/campaigns/${req.params.campaignId}/sequence-analytics?start_date=${start_date}&end_date=${end_date}`
    );
    // Normalize — Smartlead may return data in various shapes
    const seqs = Array.isArray(raw?.data) ? raw.data : raw?.data?.sequence_analytics || [];
    res.json({ ok: true, data: seqs });
  } catch (err) {
    console.error('[sequence-analytics]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaign-sequences/:campaignId', async (req, res) => {
  try {
    const raw = await slFetch(`/campaigns/${req.params.campaignId}/sequences`);
    res.json({ ok: true, data: raw?.data || [] });
  } catch (err) {
    console.error('[campaign-sequences]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Inbox Replies ───────────────────────────────────────────────────────────

router.post('/inbox-replies', async (req, res) => {
  try {
    const raw = await slFetch('/master-inbox/inbox-replies', {
      method: 'POST',
      body: req.body,
    });
    res.json({ ok: true, data: raw?.data || [] });
  } catch (err) {
    console.error('[inbox-replies]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
