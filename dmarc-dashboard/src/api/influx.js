import { getIdToken } from './auth';
import { cached } from './cache';

async function authFetch(url) {
  const token = await getIdToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to load data — check API connection.');
  return res.json();
}

export function getDomainStats() {
  return cached('/api/metrics/domain-stats', () => authFetch('/api/metrics/domain-stats').then((j) => j.domains || []));
}

export function getAlerts() {
  return cached('/api/metrics/alerts', () => authFetch('/api/metrics/alerts').then((j) => j.alerts || []));
}
