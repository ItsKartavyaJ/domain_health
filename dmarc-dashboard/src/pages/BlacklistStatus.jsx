import { useEffect, useState } from 'react';
import Badge from '../components/Badge';
import { getBlacklistStatus } from '../api/influx';

export default function BlacklistStatus() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading]  = useState(true);
  const [search, setSearch]    = useState('');

  useEffect(() => {
    getBlacklistStatus()
      .then((d) => setDomains(Array.isArray(d) ? d : []))
      .catch(() => setDomains([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = domains.filter((d) =>
    (d.domain || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => { window.location.hash = 'overview'; }}
            style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8, display: 'block' }}
          >← Back to Overview</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Blacklist Status</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading…' : domains.length === 0
              ? 'No blacklisted domains detected'
              : `${domains.length} domain${domains.length !== 1 ? 's' : ''} currently blacklisted`}
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
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface)' }}>
                {['Domain', 'Lists Hit', 'Detected On'].map((label) => (
                  <th key={label} style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '9px 18px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    {domains.length === 0 ? 'All clear — no domains are currently blacklisted.' : 'No domains match your search.'}
                  </td>
                </tr>
              )}
              {filtered.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600 }}>{d.domain}</td>
                  <td style={{ padding: '12px 18px' }}>
                    <Badge type="err">{d.listCount} list{d.listCount !== 1 ? 's' : ''}</Badge>
                  </td>
                  <td style={{ padding: '12px 18px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(d.lists || []).map((l) => (
                        <span key={l} style={{ fontFamily: 'monospace', fontSize: 11, padding: '2px 7px', borderRadius: 5, background: 'var(--err-bg)', color: 'var(--err-text)', fontWeight: 500 }}>{l}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
