import { useEffect, useState, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import DateFilter from '../components/DateFilter';
import Badge from '../components/Badge';
import { getDomainHealth } from '../api/smartlead';
import { getDomainStats, refreshDomainStats } from '../api/influx';

const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

function SectionLoader({ height = 200 }) {
  return (
    <div style={{ height, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
  );
}

function mergeDomains(healthList, statsList) {
  const statsMap = {};
  for (const s of statsList) {
    if (s.domain) statsMap[s.domain.toLowerCase()] = s;
  }
  const seen = new Set();
  const merged = healthList.map((h) => {
    const key = (h.domain || '').toLowerCase();
    seen.add(key);
    const s = statsMap[key] || {};
    return {
      domain: h.domain || key,
      sent: h.sent || 0,
      opened: h.opened || 0,
      replied: h.replied || 0,
      bounced: h.bounced || 0,
      reply_rate: h.reply_rate || 0,
      bounce_rate: h.bounce_rate || 0,
      dmarc_total: s.total || 0,
      dmarc_passed: s.passed || 0,
      dmarc_rate: s.rate || 0,
      spf: s.spf || '—',
      dkim: s.dkim || '—',
      dmarc_status: s.status || '—',
    };
  });
  for (const s of statsList) {
    const key = (s.domain || '').toLowerCase();
    if (key && !seen.has(key)) {
      merged.push({
        domain: s.domain,
        sent: 0, opened: 0, replied: 0, bounced: 0,
        reply_rate: 0, bounce_rate: 0,
        dmarc_total: s.total || 0,
        dmarc_passed: s.passed || 0,
        dmarc_rate: s.rate || 0,
        spf: s.spf || '—',
        dkim: s.dkim || '—',
        dmarc_status: s.status || '—',
      });
    }
  }
  return merged;
}

export default function Domains() {
  const [startDate, setStartDate] = useState(THIRTY_DAYS_AGO);
  const [endDate, setEndDate]     = useState(TODAY);

  const [domainHealth, setDomainHealth] = useState([]);
  const [domainStats, setDomainStats]   = useState([]);

  const [healthLoading, setHL] = useState(true);
  const [statsLoading, setSL]  = useState(true);
  const [healthError, setHE]   = useState(null);
  const [statsError, setSE]    = useState(null);

  const [search, setSearch] = useState('');
  const [sort, setSort]     = useState({ key: 'sent', dir: 'desc' });

  const fetchId = useRef(0);

  function fetchAll(s, e) {
    const id = ++fetchId.current;
    setHL(true); setSL(true);
    setHE(null); setSE(null);

    getDomainHealth(s, e)
      .then((d) => { if (fetchId.current === id) setDomainHealth(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setHE(err.message); })
      .finally(() => { if (fetchId.current === id) setHL(false); });

    getDomainStats()
      .then((d) => { if (fetchId.current === id) setDomainStats(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setSE(err.message); })
      .finally(() => { if (fetchId.current === id) setSL(false); });
  }

  useEffect(() => { fetchAll(THIRTY_DAYS_AGO, TODAY); }, []);

  function onDateChange(s, e) {
    setStartDate(s);
    setEndDate(e);
    fetchAll(s, e);
  }

  function toggleSort(key) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }

  async function handleRefresh() {
    try {
      await refreshDomainStats();
    } catch {
      // ignore — fetchAll will still attempt with stale server cache
    }
    fetchAll(startDate, endDate);
  }

  const merged = (!healthLoading && !statsLoading)
    ? mergeDomains(domainHealth, domainStats)
    : healthLoading ? [] : domainHealth.map((h) => ({ ...h, dmarc_rate: 0, spf: '—', dkim: '—', dmarc_status: '—' }));

  const filtered = merged
    .filter((d) => (d.domain || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] || 0;
      const bv = b[sort.key] || 0;
      if (typeof av === 'string') return sort.dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const topByVolume = [...merged].sort((a, b) => (b.sent || 0) - (a.sent || 0)).slice(0, 10);
  const topByBounce = [...merged].filter((d) => (d.sent || 0) > 0).sort((a, b) => (b.bounce_rate || 0) - (a.bounce_rate || 0)).slice(0, 10);

  const totalSent    = merged.reduce((s, d) => s + (d.sent || 0), 0);
  const totalReplied = merged.reduce((s, d) => s + (d.replied || 0), 0);
  const totalBounced = merged.reduce((s, d) => s + (d.bounced || 0), 0);

  const isLoading = healthLoading || statsLoading;

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Sending Domains</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {isLoading ? 'Loading…' : `${merged.length} domains`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.6 : 1 }}
          >
            {isLoading ? 'Loading…' : '↻ Refresh'}
          </button>
          <DateFilter startDate={startDate} endDate={endDate} onChange={onDateChange} />
        </div>
      </div>

      {/* Summary stats */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, height: 88, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Domains', value: merged.length, sub: 'sending domains' },
            { label: 'Total Sent', value: totalSent.toLocaleString(), sub: 'emails sent' },
            { label: 'Total Replies', value: totalReplied.toLocaleString(), sub: totalSent > 0 ? `${Math.round((totalReplied / totalSent) * 100)}% reply rate` : '' },
            { label: 'Total Bounced', value: totalBounced.toLocaleString(), sub: totalSent > 0 ? `${Math.round((totalBounced / totalSent) * 100)}% bounce rate` : '', color: totalBounced > 0 ? 'var(--err-text)' : undefined },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--text)', letterSpacing: '-0.02em' }}>{value}</div>
              {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
        {/* Volume by domain */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Email Volume by Domain</div>
          {healthLoading ? <SectionLoader height={240} /> : healthError ? (
            <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--err-text)', fontSize: 13 }}>{healthError}</div>
          ) : topByVolume.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topByVolume.map((d) => ({ name: d.domain, sent: d.sent, replied: d.replied, bounced: d.bounced }))} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'var(--text)' }} width={110} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} cursor={{ fill: 'var(--surface)', opacity: 0.5 }} />
                <Bar dataKey="sent" fill="#3B82F6" name="Sent" radius={[0, 4, 4, 0]} barSize={10} />
                <Bar dataKey="replied" fill="#22C55E" name="Replied" radius={[0, 4, 4, 0]} barSize={10} />
                <Bar dataKey="bounced" fill="#EF4444" name="Bounced" radius={[0, 4, 4, 0]} barSize={10} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No data</div>
          )}
        </div>

        {/* Bounce rate by domain */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Bounce Rate by Domain</div>
          {healthLoading ? <SectionLoader height={240} /> : healthError ? (
            <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--err-text)', fontSize: 13 }}>{healthError}</div>
          ) : topByBounce.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topByBounce.map((d) => ({ name: d.domain, bounce_rate: d.bounce_rate || 0 }))} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'var(--text)' }} width={110} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} cursor={{ fill: 'var(--surface)', opacity: 0.5 }} formatter={(v) => [`${v}%`, 'Bounce Rate']} />
                <Bar dataKey="bounce_rate" radius={[0, 4, 4, 0]} barSize={10} name="Bounce Rate">
                  {topByBounce.map((d, i) => (
                    <Cell key={i} fill={(d.bounce_rate || 0) > 3 ? '#EF4444' : (d.bounce_rate || 0) > 1 ? '#F59E0B' : '#22C55E'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No data</div>
          )}
        </div>
      </div>

      {/* Full domain table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>All Domains</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Sending performance + DMARC status per domain</div>
          </div>
          <input
            placeholder="Search domains..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 13, padding: '7px 12px', width: 220, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
        {isLoading ? <SectionLoader height={160} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {[
                    { key: 'domain', label: 'Domain' },
                    { key: 'sent', label: 'Sent' },
                    { key: 'opened', label: 'Opened' },
                    { key: 'replied', label: 'Replied' },
                    { key: 'reply_rate', label: 'Reply Rate' },
                    { key: 'bounced', label: 'Bounced' },
                    { key: 'bounce_rate', label: 'Bounce Rate' },
                    { key: 'dmarc_rate', label: 'DMARC Pass' },
                    { key: 'spf', label: 'SPF' },
                    { key: 'dkim', label: 'DKIM' },
                    { key: 'dmarc_status', label: 'Status' },
                  ].map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '9px 14px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer' }}
                    >
                      {label}{sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={11} style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No domains found</td></tr>
                )}
                {filtered.map((d, i) => {
                  const bounceRate = d.bounce_rate || 0;
                  const dmarcRate  = d.dmarc_rate || 0;
                  const dmarcType  = dmarcRate >= 90 ? 'ok' : dmarcRate >= 70 ? 'warn' : dmarcRate > 0 ? 'err' : undefined;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600 }}>{d.domain}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13 }}>{(d.sent || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13 }}>{(d.opened || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>{(d.replied || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13 }}>{d.reply_rate ? `${Math.round(d.reply_rate * 100) / 100}%` : '—'}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13 }}>{(d.bounced || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <Badge type={bounceRate > 3 ? 'err' : bounceRate > 1 ? 'warn' : 'ok'}>
                          {bounceRate ? `${Math.round(bounceRate * 100) / 100}%` : '0%'}
                        </Badge>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {dmarcType ? (
                          <Badge type={dmarcType}>{Math.round(dmarcRate)}%</Badge>
                        ) : <span style={{ fontSize: 13, color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: d.spf === 'pass' ? 'var(--ok-text)' : d.spf === 'fail' ? 'var(--err-text)' : 'var(--muted)', fontWeight: 500 }}>{d.spf}</td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: d.dkim === 'pass' ? 'var(--ok-text)' : d.dkim === 'fail' ? 'var(--err-text)' : 'var(--muted)', fontWeight: 500 }}>{d.dkim}</td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: 'var(--muted)' }}>{d.dmarc_status}</td>
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
