import { useEffect, useState } from 'react';
import DomainCard from '../components/DomainCard';
import DomainTable from '../components/DomainTable';
import { getDomainStats, refreshDomainStats, getSpfGaps, getBlacklistStatus, getDomainTrend } from '../api/influx';

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

function Chevron({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--muted)' }}>
      <polyline points="2,4 6,8 10,4" />
    </svg>
  );
}

function InsightItem({ item, spfGaps, last }) {
  const [open, setOpen] = useState(false);
  const isSpfPartial = item.title === 'SPF record is incomplete';
  const uncoveredIps = isSpfPartial ? (spfGaps[item.domain] || []) : [];
  const dotColor = item.severity === 'err' ? 'var(--err-text)' : 'var(--warn-text)';

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: dotColor }}>{item.domain}</span>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}> — {item.title}</span>
        </div>
        <Chevron open={open} />
      </div>
      {open && (
        <div style={{ padding: '0 18px 14px 36px' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>{item.action}</div>
          {isSpfPartial && (
            <div style={{ marginTop: 10 }}>
              {uncoveredIps.length > 0 ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Unauthorized sending IPs ({uncoveredIps.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {uncoveredIps.map(ip => (
                      <span key={ip} style={{ fontFamily: 'monospace', fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'var(--warn-bg)', color: 'var(--warn-text)', fontWeight: 500 }}>
                        {ip}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                    Add these to your SPF record or include the Smartlead <code style={{ fontFamily: 'monospace' }}>include:</code> mechanism.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                  No IP-level data yet — SPF validator hasn't run for this domain.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightsPanel({ domains, spfGaps, blacklist }) {
  const blacklistItems = blacklist.map((b) => ({
    severity: 'err',
    domain: b.domain,
    title: `Listed on ${b.listCount} blacklist${b.listCount !== 1 ? 's' : ''}`,
    action: `This domain was found on: ${b.lists.slice(0, 5).join(', ')}${b.lists.length > 5 ? ` and ${b.lists.length - 5} more` : ''}. Investigate sending practices and request delisting from each provider.`,
    isBlacklist: true,
  }));
  const items = [...blacklistItems, ...buildInsights(domains)];

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
          <InsightItem key={i} item={item} spfGaps={spfGaps} last={i === items.length - 1} />
        ))}
      </div>
    </div>
  );
}

export default function Overview() {
  const [domains, setDomains]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [spfGaps, setSpfGaps]       = useState({});
  const [blacklist, setBlacklist]   = useState([]);
  const [trendMap, setTrendMap]     = useState({});

  function fetchData() {
    setLoading(true);
    setError(null);
    getDomainStats()
      .then(setDomains)
      .catch(() => setError('Failed to load domain stats.'))
      .finally(() => setLoading(false));
    getSpfGaps().then(setSpfGaps).catch(() => {});
    getBlacklistStatus().then(setBlacklist).catch(() => {});
    getDomainTrend().then((trends) => {
      const map = {};
      for (const t of trends) map[t.domain] = t;
      setTrendMap(map);
    }).catch(() => {});
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
      {!loading && !error && <InsightsPanel domains={domains} spfGaps={spfGaps} blacklist={blacklist} />}

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
              {(() => {
                const bItems = blacklist.map((b) => ({
                  severity: 'err', domain: b.domain,
                  title: `Listed on ${b.listCount} blacklist${b.listCount !== 1 ? 's' : ''}`,
                  action: `Found on: ${b.lists.slice(0, 5).join(', ')}${b.lists.length > 5 ? ` and ${b.lists.length - 5} more` : ''}. Investigate and request delisting.`,
                }));
                const allItems = [...bItems, ...buildInsights(domains)];
                if (allItems.length === 0) return (
                  <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>No issues — everything looks good.</div>
                );
                return allItems.map((item, i, arr) => (
                  <InsightItem key={i} item={item} spfGaps={spfGaps} last={i === arr.length - 1} />
                ));
              })()}
            </div>
          </div>

          {/* Domain health */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Domain health</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>DMARC pass rate per domain · target 80%+</div>
            </div>
            <div style={{ padding: '4px 0' }}>
              {domains.slice(0, 5).map((d, i) => {
                const trend = trendMap[d.domain];
                const delta = trend ? trend.delta : null;
                return (
                  <div key={d.domain} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.domain}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{d.total.toLocaleString()} emails</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
                      {delta !== null && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: delta > 0 ? 'var(--ok-text)' : delta < 0 ? 'var(--err-text)' : 'var(--muted)', minWidth: 36, textAlign: 'right' }}>
                          {delta > 0 ? `↑+${delta}%` : delta < 0 ? `↓${delta}%` : '→'}
                        </span>
                      )}
                      <div style={{ width: 48, height: 4, background: 'var(--surface)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.rate}%`, background: d.status === 'ok' ? '#22C55E' : d.status === 'warn' ? '#F59E0B' : '#EF4444', borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, minWidth: 36, textAlign: 'right', color: d.status === 'ok' ? 'var(--ok-text)' : d.status === 'warn' ? 'var(--warn-text)' : 'var(--err-text)' }}>
                        {d.rate}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {domains.length > 5 && (
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => { window.location.hash = 'domains'; }}
                  style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  View all {domains.length} domains →
                </button>
              </div>
            )}
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
