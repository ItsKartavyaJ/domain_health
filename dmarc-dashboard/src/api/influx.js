export async function getDomainStats() {
  const res = await fetch('/api/metrics/domain-stats', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load domain stats');
  const json = await res.json();
  return json.domains || [];
}

export async function getAlerts() {
  const res = await fetch('/api/metrics/alerts', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load alerts');
  const json = await res.json();
  return json.alerts || [];
}