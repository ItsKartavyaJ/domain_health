import { useEffect, useState } from 'react';
import DomainCard from '../components/DomainCard';
import DomainTable from '../components/DomainTable';
import { getDomainStats, getAlerts, refreshDomainStats } from '../api/influx';

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

function SectionSkeleton({ height = 120 }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, height, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      Loading…
    </div>
  );
}

export default function Overview() {
  const [domains, setDomains]         = useState([]);
  const [alerts, setAlerts]           = useState([]);
  const [domainsLoading, setDL]       = useState(true);
  const [alertsLoading, setAL]        = useState(true);
  const [domainsError, setDE]         = useState(null);
  const [alertsError, setAE]          = useState(null);

  useEffect(() => {
    getDomainStats()
      .then(setDomains)
      .catch(() => setDE('Failed to load domain stats.'))
      .finally(() => setDL(false));

    getAlerts()
      .then(setAlerts)
      .catch(() => setAE('Failed to load alerts.'))
      .finally(() => setAL(false));
  }, []);

  async function handleRefresh() {
    setDL(true); setAL(true);
    setDE(null); setAE(null);
    try {
      await refreshDomainStats();
    } catch {
      // ignore — fetch will still attempt with stale server cache
    }
    getDomainStats()
      .then(setDomains)
      .catch(() => setDE('Failed to load domain stats.'))
      .finally(() => setDL(false));
    getAlerts()
      .then(setAlerts)
      .catch(() => setAE('Failed to load alerts.'))
      .finally(() => setAL(false));
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
            {domainsLoading ? 'Loading…' : `${domains.length} domains · last 30 days`}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={domainsLoading}
          style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: domainsLoading ? 'not-allowed' : 'pointer', opacity: domainsLoading ? 0.6 : 1 }}
        >
          {domainsLoading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Summary stats — shows as soon as domains load */}
      {domainsLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          {[0,1,2,3].map(i => <SectionSkeleton key={i} height={88} />)}
        </div>
      ) : domainsError ? (
        <div style={{ background: 'var(--err-bg)', color: 'var(--err-text)', borderRadius: 10, padding: '14px 20px', fontSize: 13, marginBottom: 28 }}>{domainsError}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          <StatPill label="Domains" value={domains.length} sub="monitored" />
          <StatPill label="Avg DMARC score" value={`${avgScore}%`} sub="across all domains"
            color={avgScore > 80 ? 'var(--ok-text)' : avgScore > 50 ? 'var(--warn-text)' : 'var(--err-text)'} />
          <StatPill label="Total emails" value={totalEmails.toLocaleString()} sub="last 30 days" />
          <StatPill label="Healthy domains" value={healthy} sub={`${domains.length - healthy} need attention`}
            color={healthy === domains.length ? 'var(--ok-text)' : 'var(--warn-text)'} />
        </div>
      )}

      {/* Top domain cards */}
      {!domainsLoading && domains.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Top domains</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 28 }}>
            {domains.slice(0, 3).map(d => <DomainCard key={d.domain} {...d} />)}
          </div>
        </>
      )}

      {/* Alerts + Domain health — each section independent */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 12, marginBottom: 28 }}>
        {/* Alerts */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Recent alerts</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Issues that need your attention</div>
          </div>
          <div style={{ padding: '4px 0' }}>
            {alertsLoading && (
              <div style={{ padding: '32px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>Loading alerts…</div>
            )}
            {alertsError && (
              <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--err-text)' }}>{alertsError}</div>
            )}
            {!alertsLoading && !alertsError && alerts.length === 0 && (
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

        {/* Domain health */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Domain health</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>DMARC pass rate per domain</div>
          </div>
          <div style={{ padding: '4px 0', maxHeight: 360, overflowY: 'auto' }}>
            {domainsLoading && (
              <div style={{ padding: '32px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>Loading…</div>
            )}
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

      {/* Full table */}
      {!domainsLoading && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>All domains</div>
          <DomainTable domains={domains} />
        </>
      )}
    </main>
  );
}
