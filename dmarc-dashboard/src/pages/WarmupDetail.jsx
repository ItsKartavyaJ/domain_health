import { useEffect, useState } from 'react';
import Badge from '../components/Badge';
import { getWarmupSummary } from '../api/influx';

export default function WarmupDetail() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [sort, setSort]       = useState({ key: 'avg_health', dir: 'desc' });

  useEffect(() => {
    getWarmupSummary()
      .then((d) => setDomains(Array.isArray(d) ? d : []))
      .catch(() => setDomains([]))
      .finally(() => setLoading(false));
  }, []);

  function toggleSort(key) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const filtered = domains
    .filter((d) => (d.domain || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] ?? -1;
      const bv = b[sort.key] ?? -1;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const totalMailboxes  = domains.reduce((s, d) => s + (d.total_mailboxes || 0), 0);
  const enabledMailboxes = domains.reduce((s, d) => s + (d.enabled_count || 0), 0);
  const avgHealth = domains.length
    ? Math.round(domains.reduce((s, d) => s + (d.avg_health ?? 0), 0) / domains.length)
    : null;
  const avgSpam = domains.length
    ? (domains.reduce((s, d) => s + (d.avg_spam_pct ?? 0), 0) / domains.length).toFixed(1)
    : null;

  const columns = [
    { key: 'domain', label: 'Domain', sortable: false },
    { key: 'enabled_count', label: 'Enabled / Total', sortable: true },
    { key: 'avg_health', label: 'Avg Health', sortable: true },
    { key: 'avg_spam_pct', label: 'Avg Spam %', sortable: true },
    { key: 'status', label: 'Status', sortable: false },
  ];

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => { window.location.hash = 'mailboxes'; }}
            style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8, display: 'block' }}
          >← Back to Mailboxes</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Warmup Health</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading…' : `${domains.length} domain${domains.length !== 1 ? 's' : ''} · ${enabledMailboxes} of ${totalMailboxes} mailboxes warming`}
          </p>
        </div>
        <input
          placeholder="Search domains..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: '7px 12px', width: 220, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
        />
      </div>

      {/* Summary stat pills */}
      {!loading && domains.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Domains', value: domains.length },
            { label: 'Enabled mailboxes', value: `${enabledMailboxes} / ${totalMailboxes}` },
            {
              label: 'Avg health score', value: avgHealth != null ? `${avgHealth}` : '—',
              color: avgHealth == null ? undefined : avgHealth >= 80 ? 'var(--ok-text)' : avgHealth >= 60 ? 'var(--warn-text)' : 'var(--err-text)',
            },
            {
              label: 'Avg spam rate', value: avgSpam != null ? `${avgSpam}%` : '—',
              color: avgSpam == null ? undefined : avgSpam <= 1 ? 'var(--ok-text)' : avgSpam <= 3 ? 'var(--warn-text)' : 'var(--err-text)',
            },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--text)', letterSpacing: '-0.02em' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ height: 160, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {columns.map(({ key, label, sortable }) => (
                    <th
                      key={key}
                      onClick={() => sortable && toggleSort(key)}
                      style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '9px 18px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: sortable ? 'pointer' : 'default' }}
                    >
                      {label}{sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      {domains.length === 0 ? 'No warmup data available.' : 'No domains match your search.'}
                    </td>
                  </tr>
                )}
                {filtered.map((d, i) => {
                  const health = d.avg_health ?? null;
                  const spam   = d.avg_spam_pct ?? null;
                  const healthType = health === null ? undefined : health >= 80 ? 'ok' : health >= 60 ? 'warn' : 'err';
                  const spamType   = spam === null ? undefined : spam <= 1 ? 'ok' : spam <= 3 ? 'warn' : 'err';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600 }}>{d.domain}</td>
                      <td style={{ padding: '12px 18px', fontSize: 13 }}>{d.enabled_count} / {d.total_mailboxes}</td>
                      <td style={{ padding: '12px 18px' }}>
                        {health !== null ? (
                          <Badge type={healthType}>{Math.round(health)}</Badge>
                        ) : <span style={{ fontSize: 13, color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 18px' }}>
                        {spam !== null ? (
                          <Badge type={spamType}>{spam.toFixed(1)}%</Badge>
                        ) : <span style={{ fontSize: 13, color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 18px' }}>
                        {d.enabled_count === 0 ? (
                          <Badge type="warn">All paused</Badge>
                        ) : d.enabled_count < d.total_mailboxes ? (
                          <Badge type="warn">{d.total_mailboxes - d.enabled_count} paused</Badge>
                        ) : (
                          <Badge type="ok">All warming</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
