import { useEffect, useState } from 'react';
import DomainCard from '../components/DomainCard';
import DomainTable from '../components/DomainTable';
import { getDomainStats, refreshDomainStats } from '../api/influx';

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

function buildInsights(domains) {
  const items = [];
  for (const d of domains) {
    if (d.dkim === 'Fail') {
      items.push({
        severity: 'err',
        domain: d.domain,
        title: 'DKIM not configured',
        action: 'Add a DKIM TXT record in your DNS provider. Without it, emails are unsigned and far more likely to be flagged as spam by Gmail and Outlook.',
      });
    } else if (d.rate < 50) {
      items.push({
        severity: 'err',
        domain: d.domain,
        title: `${100 - d.rate}% of emails failing DMARC`,
        action: 'More than half of emails from this domain are failing DMARC. Gmail and Outlook may block or quarantine them. Verify SPF and DKIM are both aligned.',
      });
    } else if (d.spf === 'Fail') {
      items.push({
        severity: 'err',
        domain: d.domain,
        title: 'No SPF record found',
        action: 'Add a DNS TXT record to authorize your mail servers: v=spf1 include:your-mail-provider.com ~all',
      });
    } else if (d.spf === 'Partial') {
      items.push({
        severity: 'warn',
        domain: d.domain,
        title: 'SPF record is incomplete',
        action: 'Some sending IPs are not covered by your SPF record. Review which mail servers send on behalf of this domain and add any missing ones.',
      });
    } else if (d.rate <= 80) {
      items.push({
        severity: 'warn',
        domain: d.domain,
        title: `DMARC pass rate at ${d.rate}%`,
        action: 'Below 80% — Google may throttle delivery from this domain. Check that SPF and DKIM alignment are correctly configured in your mail platform.',
      });
    }
  }
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'err' ? -1 : 1));
}

function InsightsPanel({ domains }) {
  const items = buildInsights(domains);

  if (items.length === 0) {
    return (
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 20px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok-text)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ok-text)' }}>All domains healthy</span>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>— SPF, DKIM and DMARC passing on all monitored domains.</span>
      </div>
    );
  }

  const errCount  = items.filter(i => i.severity === 'err').length;
  const warnCount = items.filter(i => i.severity === 'warn').length;

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Action needed</div>
        {errCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--err-bg)', color: 'var(--err-text)' }}>
            {errCount} critical
          </span>
        )}
        {warnCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--warn-bg)', color: 'var(--warn-text)' }}>
            {warnCount} warning{warnCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '13px 18px', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.severity === 'err' ? 'var(--err-text)' : 'var(--warn-text)', marginTop: 5, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
                <span style={{ color: item.severity === 'err' ? 'var(--err-text)' : 'var(--warn-text)' }}>{item.domain}</span>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}> — {item.title}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{item.action}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Overview() {
  const [domains, setDomains]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  function fetchData() {
    setLoading(true);
    setError(null);
    getDomainStats()
      .then(setDomains)
      .catch(() => setError('Failed to load domain stats.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, []);

  async function handleRefresh() {
    try { await refreshDomainStats(); } catch { /* best-effort cache bust */ }
    fetchData();
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
            {loading ? 'Loading…' : `${domains.length} domains · last 30 days`}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}
        >
          ↻ {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Summary stats */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          {[0,1,2,3].map(i => <SectionSkeleton key={i} height={88} />)}
        </div>
      ) : error ? (
        <div style={{ background: 'var(--err-bg)', color: 'var(--err-text)', borderRadius: 10, padding: '14px 20px', fontSize: 13, marginBottom: 28 }}>{error}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          <StatPill label="Domains" value={domains.length} sub="monitored" />
          <StatPill label="Avg DMARC score" value={`${avgScore}%`} sub={avgScore >= 80 ? 'above target' : avgScore >= 50 ? 'below 80% target' : 'critical — below 50%'}
            color={avgScore >= 80 ? 'var(--ok-text)' : avgScore >= 50 ? 'var(--warn-text)' : 'var(--err-text)'} />
          <StatPill label="Total emails" value={totalEmails.toLocaleString()} sub="last 30 days" />
          <StatPill label="Healthy domains" value={healthy} sub={domains.length - healthy === 0 ? 'all clear' : `${domains.length - healthy} need attention`}
            color={healthy === domains.length ? 'var(--ok-text)' : 'var(--warn-text)'} />
        </div>
      )}

      {/* Insights panel — only after domains load */}
      {!loading && !error && <InsightsPanel domains={domains} />}

      {/* Top domain cards */}
      {!loading && domains.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Top domains</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 28 }}>
            {domains.slice(0, 3).map(d => <DomainCard key={d.domain} {...d} />)}
          </div>
        </>
      )}

      {/* Issues list + Domain health */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 12, marginBottom: 28 }}>
          {/* Issues list */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>What to fix</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Specific actions to improve deliverability</div>
            </div>
            <div style={{ padding: '4px 0' }}>
              {buildInsights(domains).length === 0 ? (
                <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>No issues — everything looks good.</div>
              ) : (
                buildInsights(domains).map((item, i, arr) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 18px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.severity === 'err' ? 'var(--err-text)' : 'var(--warn-text)', marginTop: 5, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        <span style={{ color: item.severity === 'err' ? 'var(--err-text)' : 'var(--warn-text)' }}>{item.domain}</span>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}> — {item.title}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>{item.action}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Domain health */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Domain health</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>DMARC pass rate per domain · target 80%+</div>
            </div>
            <div style={{ padding: '4px 0', maxHeight: 360, overflowY: 'auto' }}>
              {domains.map((d, i) => (
                <div key={d.domain} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 18px', borderBottom: i < domains.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.domain}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{d.total.toLocaleString()} emails</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
                    <div style={{ width: 48, height: 4, background: 'var(--surface)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${d.rate}%`, background: d.status === 'ok' ? '#22C55E' : d.status === 'warn' ? '#F59E0B' : '#EF4444', borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, minWidth: 36, textAlign: 'right', color: d.status === 'ok' ? 'var(--ok-text)' : d.status === 'warn' ? 'var(--warn-text)' : 'var(--err-text)' }}>
                      {d.rate}%
                    </span>
                  </div>
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
    </main>
  );
}
