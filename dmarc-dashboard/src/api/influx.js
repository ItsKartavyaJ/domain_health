import { getIdToken } from './auth';

async function authFetch(url) {
  const token = await getIdToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to load data — check API connection.');
  return res.json();
}

export async function getDomainStats() {
  const json = await authFetch('/api/metrics/domain-stats');
  return json.domains || [];
}

export async function getAlerts() {
  const json = await authFetch('/api/metrics/alerts');
  return json.alerts || [];
}
