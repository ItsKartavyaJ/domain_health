import { useEffect, useState } from 'react';
import { getDomainStats, getSpfGaps, getBlacklistStatus } from '../api/influx';

function buildInsights(domains) {
  const items = [];
  for (const d of domains) {
    if (d.dkim === 'Fail') {
      items.push({
        severity: 'err', domain: d.domain,
        title: 'DKIM not configured',
        action: 'Add a DKIM TXT record in your DNS provider. Without it, emails are unsigned and far more likely to be flagged as spam by Gmail and Outlook.',
      });
    } else if (d.rate < 50) {
      items.push({
        severity: 'err', domain: d.domain,
        title: `${100 - d.rate}% of emails failing DMARC`,
        action: 'More than half of emails from this domain are failing DMARC. Gmail and Outlook may block or quarantine them. Verify SPF and DKIM are both aligned.',
      });
    } else if (d.spf === 'Fail') {
      items.push({
        severity: 'err', domain: d.domain,
        title: 'No SPF record found',
        action: 'Add a DNS TXT record to authorize your mail servers: v=spf1 include:your-mail-provider.com ~all',
      });
    } else if (d.spf === 'Partial') {
      items.push({
        severity: 'warn', domain: d.domain,
        title: 'SPF record is incomplete',
        action: 'Some sending IPs are not covered by your SPF record. Review which mail servers send on behalf of this domain and add any missing ones.',
      });
    } else if (d.rate <= 80) {
      items.push({
        severity: 'warn', domain: d.domain,
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
          {isSpfPartial && uncoveredIps.length > 0 && (
            <div style={{ marginTop: 10 }}>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Issues() {
  const [domains, setDomains]   = useState([]);
  const [spfGaps, setSpfGaps]   = useState({});
  const [blacklist, setBlacklist] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');

  useEffect(() => {
    Promise.all([
      getDomainStats().catch(() => []),
      getSpfGaps().catch(() => ({})),
      getBlacklistStatus().catch(() => []),
    ]).then(([d, gaps, bl]) => {
      setDomains(Array.isArray(d) ? d : []);
      setSpfGaps(gaps || {});
      setBlacklist(Array.isArray(bl) ? bl : []);
    }).finally(() => setLoading(false));
  }, []);

  const blacklistItems = blacklist.map((b) => ({
    severity: 'err', domain: b.domain,
    title: `Listed on ${b.listCount} blacklist${b.listCount !== 1 ? 's' : ''}`,
    action: `Found on: ${b.lists.slice(0, 5).join(', ')}${b.lists.length > 5 ? ` and ${b.lists.length - 5} more` : ''}. Investigate sending practices and request delisting from each provider.`,
  }));
  const allItems = [...blacklistItems, ...buildInsights(domains)];

  const filtered = allItems.filter((item) => {
    const matchesSeverity = severityFilter === 'all' || item.severity === severityFilter;
    const matchesSearch = (item.domain || '').toLowerCase().includes(search.toLowerCase())
      || (item.title || '').toLowerCase().includes(search.toLowerCase());
    return matchesSeverity && matchesSearch;
  });

  const errCount  = allItems.filter(i => i.severity === 'err').length;
  const warnCount = allItems.filter(i => i.severity === 'warn').length;

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => { window.location.hash = 'overview'; }}
            style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8, display: 'block' }}
          >← Back to Overview</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>All Issues</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading…' : allItems.length === 0
              ? 'No issues detected'
              : `${errCount} critical · ${warnCount} warning`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {['all', 'err', 'warn'].map((f) => (
            <button
              key={f}
              onClick={() => setSeverityFilter(f)}
              style={{
                fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
                background: severityFilter === f ? 'var(--accent)' : 'var(--card-bg)',
                color: severityFilter === f ? 'white' : 'var(--muted)',
                fontWeight: severityFilter === f ? 600 : 400,
              }}
            >
              {f === 'all' ? 'All' : f === 'err' ? 'Critical' : 'Warnings'}
            </button>
          ))}
          <input
            placeholder="Search domains..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 13, padding: '7px 12px', width: 200, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
      </div>

      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ height: 160, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            {allItems.length === 0 ? 'All domains healthy — no issues detected.' : 'No issues match your filter.'}
          </div>
        ) : (
          filtered.map((item, i) => (
            <InsightItem key={i} item={item} spfGaps={spfGaps} last={i === filtered.length - 1} />
          ))
        )}
      </div>
    </main>
  );
}
