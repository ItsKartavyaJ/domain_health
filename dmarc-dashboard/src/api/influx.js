import { getIdToken } from './auth';
import { cached, invalidate } from './cache';

async function authFetch(url) {
  const token = await getIdToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Failed to load data — HTTP ${res.status}`);
  return res.json();
}

export function getDomainStats() {
  return cached('/api/metrics/domain-stats', () => authFetch('/api/metrics/domain-stats').then((j) => j.domains || []));
}

export function getAlerts() {
  return cached('/api/metrics/alerts', () => authFetch('/api/metrics/alerts').then((j) => j.alerts || []));
}

export function getSpfGaps() {
  return cached('/api/metrics/spf-gaps', () => authFetch('/api/metrics/spf-gaps').then((j) => j.gaps || {}));
}

export function getBlacklistStatus() {
  return cached('/api/metrics/blacklist-status', () => authFetch('/api/metrics/blacklist-status').then((j) => j.domains || []));
}

export function getDnsStatus() {
  return cached('/api/metrics/dns-status', () => authFetch('/api/metrics/dns-status').then((j) => j.domains || []));
}

export function getDomainTrend() {
  return cached('/api/metrics/domain-trend', () => authFetch('/api/metrics/domain-trend').then((j) => j.trends || []));
}

export function getWarmupSummary() {
  return cached('/api/metrics/warmup-summary', () => authFetch('/api/metrics/warmup-summary').then((j) => j.domains || []));
}

export function getSenderHealth() {
  return cached('/api/metrics/sender-health', () => authFetch('/api/metrics/sender-health').then((j) => j.domains || []));
}

export function getDmarcSources() {
  return cached('/api/metrics/dmarc-sources', () => authFetch('/api/metrics/dmarc-sources').then((j) => j.sources || []));
}

export async function refreshDomainStats() {
  const token = await getIdToken();
  const res = await fetch('/api/metrics/refresh', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Refresh failed — HTTP ${res.status}`);
  invalidate('/api/metrics/');
}
