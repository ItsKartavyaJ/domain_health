import { useEffect, useState } from 'react';
import DomainCard from '../components/DomainCard';
import DomainTable from '../components/DomainTable';
import { getDomainStats, getAlerts } from '../api/influx';

const dotColor = { red: '#EF4444', amber: '#F59E0B', green: '#22C55E' };

function StatPill({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--text)', letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Overview() {
  const [domains, setDomains] = useState([]);
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    Promise.all([getDomainStats(), getAlerts()])
      .then(([d, a]) => { setDomains(d); setAlerts(a); })
      .catch((err) => { console.error(err); setError('Failed to load data — check API connection.'); })
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: 'var(--err-bg)', color: 'var(--err-text)', borderRadius: 10, padding: '14px 20px', fontSize: 13, maxWidth: 480 }}>{error}</div>
      </div>
    );
  }

  const totalEmails = domains.reduce((s, d) => s + d.total, 0);
  const avgScore    = domains.length ? Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length) : 0;
  const healthy     = domains.filter(d => d.status === 'ok').length;

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      {/* Page title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Overview</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading data…' : `${domains.length} domains · last 48 hours`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', cursor: 'pointer' }}>Export CSV</button>
          <button style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>+ Add domain</button>
        </div>
      </div>

      {/* Summary stats */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          <StatPill label="Domains" value={domains.length} sub="monitored" />
          <StatPill label="Avg DMARC score" value={`${avgScore}%`} sub="across all domains"
            color={avgScore > 80 ? 'var(--ok-text)' : avgScore > 50 ? 'var(--warn-text)' : 'var(--err-text)'} />
          <StatPill label="Emails (48h)" value={totalEmails.toLocaleString()} sub="total received" />
          <StatPill label="Healthy domains" value={healthy} sub={`${domains.length - healthy} need attention`}
            color={healthy === domains.length ? 'var(--ok-text)' : 'var(--warn-text)'} />
        </div>
      )}

      {/* Top domain cards */}
      {!loading && domains.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Top domains</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 28 }}>
            {domains.slice(0, 3).map(d => <DomainCard key={d.domain} {...d} />)}
          </div>
        </>
      )}

      {/* Alerts + Report status */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 12, marginBottom: 28 }}>
          {/* Alerts */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Recent alerts</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Issues that need your attention</div>
            </div>
            <div style={{ padding: '4px 0' }}>
              {alerts.length === 0 && (
                <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>No alerts — everything looks good.</div>
              )}
              {alerts.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 18px', borderBottom: i < alerts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor[a.type], marginTop: 5, flexShrink: 0 }}/>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.message}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>{a.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Report status */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Domain health</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>DMARC pass rate per domain</div>
            </div>
            <div style={{ padding: '4px 0' }}>
              {domains.map((d, i) => (
                <div key={d.domain} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 18px', borderBottom: i < domains.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.domain}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{d.total.toLocaleString()} emails</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 12, color: d.status === 'ok' ? 'var(--ok-text)' : d.status === 'warn' ? 'var(--warn-text)' : 'var(--err-text)' }}>
                    {d.rate}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full table */}
      {!loading && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>All domains</div>
          <DomainTable domains={domains} />
        </>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, color: 'var(--muted)', fontSize: 13 }}>
          Loading domain data…
        </div>
      )}
    </main>
  );
}
