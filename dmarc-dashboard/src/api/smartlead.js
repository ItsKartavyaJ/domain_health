import { getIdToken } from './auth';
import { cached } from './cache';

async function authFetch(url, opts = {}) {
  const token = await getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) p.set(k, v);
  }
  return p.toString();
}

export function getReplyCategories(startDate, endDate) {
  const url = `/api/smartlead/reply-categories?${qs({ start_date: startDate, end_date: endDate })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getDailyStats(startDate, endDate) {
  const url = `/api/smartlead/daily-stats?${qs({ start_date: startDate, end_date: endDate })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getDailyPositiveReplies(startDate, endDate) {
  const url = `/api/smartlead/daily-positive-replies?${qs({ start_date: startDate, end_date: endDate })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getResponseStats(startDate, endDate) {
  const url = `/api/smartlead/response-stats?${qs({ start_date: startDate, end_date: endDate })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getMailboxHealth(startDate, endDate, limit = 100, offset = 0) {
  const url = `/api/smartlead/mailbox-health?${qs({ start_date: startDate, end_date: endDate, limit, offset })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getDomainHealth(startDate, endDate) {
  const url = `/api/smartlead/domain-health?${qs({ start_date: startDate, end_date: endDate })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getProviderStats(startDate, endDate) {
  const url = `/api/smartlead/provider-stats?${qs({ start_date: startDate, end_date: endDate })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getMailboxOverall() {
  return cached('/api/smartlead/mailbox-overall', () => authFetch('/api/smartlead/mailbox-overall').then((j) => j.data || {}));
}

export function getEmailAccounts(limit = 100, offset = 0) {
  const url = `/api/smartlead/email-accounts?${qs({ limit, offset })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getCampaignStats(startDate, endDate, limit = 50, offset = 0) {
  const url = `/api/smartlead/campaign-stats?${qs({ start_date: startDate, end_date: endDate, limit, offset })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}

export function getCampaignList() {
  return cached('/api/smartlead/campaigns', () => authFetch('/api/smartlead/campaigns').then((j) => j.data || []));
}

export function getSequenceAnalytics(campaignId, startDate, endDate) {
  const url = `/api/smartlead/sequence-analytics/${campaignId}?${qs({ start_date: startDate, end_date: endDate })}`;
  return cached(url, () => authFetch(url).then((j) => j.data || []));
}
