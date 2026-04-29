import { useEffect, useState } from 'react';
import Badge from '../components/Badge';
import { getDnsStatus } from '../api/influx';

export default function DnsStatus() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [sort, setSort]       = useState({ key: 'score', dir: 'desc' });

  useEffect(() => {
    getDnsStatus()
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
      const av = a[sort.key] ?? 0;
      const bv = b[sort.key] ?? 0;
      if (typeof av === 'boolean') return sort.dir === 'desc' ? (bv ? 1 : 0) - (av ? 1 : 0) : (av ? 1 : 0) - (bv ? 1 : 0);
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const columns = [
    { key: 'domain', label: 'Domain', sortable: false },
    { key: 'score', label: 'Score', sortable: true },
    { key: 'dmarc_policy', label: 'DMARC Policy', sortable: false },
    { key: 'spf_valid', label: 'SPF', sortable: true },
    { key: 'dkim_valid', label: 'DKIM', sortable: true },
    { key: 'dmarc_valid', label: 'DMARC', sortable: true },
  ];

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => { window.location.hash = 'overview'; }}
            style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8, display: 'block' }}
          >← Back to Overview</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>DNS Status</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading…' : `${domains.length} domain${domains.length !== 1 ? 's' : ''} monitored`}
          </p>
        </div>
        <input
          placeholder="Search domains..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: '7px 12px', width: 220, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
        />
      </div>

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
                    <td colSpan={6} style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      {domains.length === 0 ? 'No DNS data available.' : 'No domains match your search.'}
                    </td>
                  </tr>
                )}
                {filtered.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600 }}>{d.domain}</td>
                    <td style={{ padding: '12px 18px' }}>
                      {d.score != null ? (
                        <Badge type={d.score >= 80 ? 'ok' : d.score >= 50 ? 'warn' : 'err'}>{d.score}</Badge>
                      ) : <span style={{ fontSize: 13, color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      {d.dmarc_policy === 'reject' ? (
                        <Badge type="ok">reject</Badge>
                      ) : d.dmarc_policy === 'quarantine' ? (
                        <Badge type="warn">quarantine</Badge>
                      ) : d.dmarc_policy === 'none' ? (
                        <Badge type="err">none</Badge>
                      ) : (
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      <Badge type={d.spf_valid ? 'ok' : 'err'}>{d.spf_valid ? 'Pass' : 'Fail'}</Badge>
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      <Badge type={d.dkim_valid ? 'ok' : 'err'}>{d.dkim_valid ? 'Pass' : 'Fail'}</Badge>
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      <Badge type={d.dmarc_valid ? 'ok' : 'err'}>{d.dmarc_valid ? 'Pass' : 'Fail'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
