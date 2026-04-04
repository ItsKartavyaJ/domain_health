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

// ── Reply Intelligence ──────────────────────────────────────────────────────

router.get('/reply-categories', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const data = await slFetch(
      `/analytics/lead/category-wise-response?start_date=${start_date}&end_date=${end_date}`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[reply-categories]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily-stats', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const data = await slFetch(
      `/analytics/day-wise-overall-stats?start_date=${start_date}&end_date=${end_date}`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[daily-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily-positive-replies', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const data = await slFetch(
      `/analytics/day-wise-positive-reply-stats?start_date=${start_date}&end_date=${end_date}`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[daily-positive-replies]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/response-stats', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const data = await slFetch(
      `/analytics/campaign/response-stats?start_date=${start_date}&end_date=${end_date}&full_data=true`
    );
    res.json({ ok: true, data });
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
    const data = await slFetch(
      `/analytics/mailbox/name-wise-health-metrics?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=${limit}&offset=${offset}`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[mailbox-health]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/domain-health', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const data = await slFetch(
      `/analytics/mailbox/domain-wise-health-metrics?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=100&offset=0`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[domain-health]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/provider-stats', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const data = await slFetch(
      `/analytics/mailbox/provider-wise-overall-performance?start_date=${start_date}&end_date=${end_date}&full_data=true`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[provider-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/mailbox-overall', async (req, res) => {
  try {
    const data = await slFetch('/analytics/mailbox/overall-stats');
    res.json({ ok: true, data });
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
    const data = await slFetch(
      `/analytics/campaign/overall-stats?start_date=${start_date}&end_date=${end_date}&full_data=true&limit=${limit}&offset=${offset}`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[campaign-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    const data = await slFetch('/analytics/campaign/list');
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[campaigns]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Sequence Performance ────────────────────────────────────────────────────

router.get('/sequence-analytics/:campaignId', async (req, res) => {
  try {
    const { start_date, end_date } = dateParams(req);
    const data = await slFetch(
      `/campaigns/${req.params.campaignId}/sequence-analytics?start_date=${start_date}&end_date=${end_date}`
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[sequence-analytics]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaign-sequences/:campaignId', async (req, res) => {
  try {
    const data = await slFetch(`/campaigns/${req.params.campaignId}/sequences`);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[campaign-sequences]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Inbox Replies ───────────────────────────────────────────────────────────

router.post('/inbox-replies', async (req, res) => {
  try {
    const data = await slFetch('/master-inbox/inbox-replies', {
      method: 'POST',
      body: req.body,
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[inbox-replies]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
