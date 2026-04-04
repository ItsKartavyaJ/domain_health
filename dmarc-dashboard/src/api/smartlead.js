import { getIdToken } from './auth';

async function authFetch(url, opts = {}) {
  const token = await getIdToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) p.set(k, v);
  }
  return p.toString();
}

export async function getReplyCategories(startDate, endDate) {
  const json = await authFetch(`/api/smartlead/reply-categories?${qs({ start_date: startDate, end_date: endDate })}`);
  return json.data || [];
}

export async function getDailyStats(startDate, endDate) {
  const json = await authFetch(`/api/smartlead/daily-stats?${qs({ start_date: startDate, end_date: endDate })}`);
  return json.data || [];
}

export async function getDailyPositiveReplies(startDate, endDate) {
  const json = await authFetch(`/api/smartlead/daily-positive-replies?${qs({ start_date: startDate, end_date: endDate })}`);
  return json.data || [];
}

export async function getResponseStats(startDate, endDate) {
  const json = await authFetch(`/api/smartlead/response-stats?${qs({ start_date: startDate, end_date: endDate })}`);
  return json.data || [];
}

export async function getMailboxHealth(startDate, endDate, limit = 100, offset = 0) {
  const json = await authFetch(`/api/smartlead/mailbox-health?${qs({ start_date: startDate, end_date: endDate, limit, offset })}`);
  return json.data || [];
}

export async function getDomainHealth(startDate, endDate) {
  const json = await authFetch(`/api/smartlead/domain-health?${qs({ start_date: startDate, end_date: endDate })}`);
  return json.data || [];
}

export async function getProviderStats(startDate, endDate) {
  const json = await authFetch(`/api/smartlead/provider-stats?${qs({ start_date: startDate, end_date: endDate })}`);
  return json.data || [];
}

export async function getMailboxOverall() {
  const json = await authFetch('/api/smartlead/mailbox-overall');
  return json.data || {};
}

export async function getEmailAccounts(limit = 100, offset = 0) {
  const json = await authFetch(`/api/smartlead/email-accounts?${qs({ limit, offset })}`);
  return json.data || [];
}

export async function getCampaignStats(startDate, endDate, limit = 50, offset = 0) {
  const json = await authFetch(`/api/smartlead/campaign-stats?${qs({ start_date: startDate, end_date: endDate, limit, offset })}`);
  return json.data || [];
}

export async function getCampaignList() {
  const json = await authFetch('/api/smartlead/campaigns');
  return json.data || [];
}

export async function getSequenceAnalytics(campaignId, startDate, endDate) {
  const json = await authFetch(`/api/smartlead/sequence-analytics/${campaignId}?${qs({ start_date: startDate, end_date: endDate })}`);
  return json.data || [];
}
