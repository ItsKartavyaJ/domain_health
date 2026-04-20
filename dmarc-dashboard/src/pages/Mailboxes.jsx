import { useEffect, useState, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import DateFilter from '../components/DateFilter';
import Badge from '../components/Badge';
import { getMailboxHealth, getDomainHealth, getEmailAccounts } from '../api/smartlead';

const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

function rateStatus(rate) {
  if (rate > 3) return 'err';
  if (rate > 1) return 'warn';
  return 'ok';
}

function mergeAccounts(healthList, accountList) {
  const acctMap = {};
  for (const a of accountList) {
    if (a.from_email) acctMap[a.from_email.toLowerCase()] = a;
  }
  const seen = new Set();
  const merged = healthList.map((m) => {
    const email = (m.from_email || '').toLowerCase();
    seen.add(email);
    const acct = acctMap[email] || {};
    const connected = acct.is_smtp_success !== false;
    const active = (m.sent || 0) > 0;
    return {
      ...m,
      connected,
      active,
      status: !connected ? 'disconnected' : !active ? 'inactive' : 'active',
      type: acct.type || '',
      warmup_enabled: acct.warmup_enabled || false,
    };
  });
  for (const a of accountList) {
    const email = (a.from_email || '').toLowerCase();
    if (email && !seen.has(email)) {
      const connected = a.is_smtp_success !== false;
      merged.push({
        from_email: a.from_email,
        sent: 0, opened: 0, replied: 0, bounced: 0,
        reply_rate: 0, bounce_rate: 0,
        connected,
        active: false,
        status: connected ? 'inactive' : 'disconnected',
        type: a.type || '',
        warmup_enabled: a.warmup_enabled || false,
      });
    }
  }
  return merged;
}

function SectionLoader({ height = 200 }) {
  return (
    <div style={{ height, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
  );
}

export default function Mailboxes() {
  const [startDate, setStartDate] = useState(THIRTY_DAYS_AGO);
  const [endDate, setEndDate]     = useState(TODAY);

  const [mailboxes, setMailboxes]   = useState([]);
  const [domains, setDomains]       = useState([]);
  const [accounts, setAccounts]     = useState([]);

  const [healthLoading, setHL] = useState(true);
  const [domLoading, setDoL]   = useState(true);
  const [acctLoading, setAL]   = useState(true);

  const [healthError, setHE] = useState(null);
  const [domError, setDoE]   = useState(null);

  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort]           = useState({ key: 'sent', dir: 'desc' });

  const fetchId = useRef(0);

  function fetchDateBound(s, e) {
    const id = ++fetchId.current;
    setHL(true); setDoL(true);
    setHE(null); setDoE(null);

    getMailboxHealth(s, e)
      .then((d) => { if (fetchId.current === id) setMailboxes(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setHE(err.message); })
      .finally(() => { if (fetchId.current === id) setHL(false); });

    getDomainHealth(s, e)
      .then((d) => { if (fetchId.current === id) setDomains(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setDoE(err.message); })
      .finally(() => { if (fetchId.current === id) setDoL(false); });
  }

  useEffect(() => {
    fetchDateBound(THIRTY_DAYS_AGO, TODAY);

    getEmailAccounts()
      .then((d) => setAccounts(Array.isArray(d) ? d : []))
      .catch(() => setAccounts([]))
      .finally(() => setAL(false));
  }, []);

  function onDateChange(s, e) {
    setStartDate(s);
    setEndDate(e);
    fetchDateBound(s, e);
  }

  function toggleSort(key) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const merged = (!healthLoading && !acctLoading)
    ? mergeAccounts(mailboxes, accounts)
    : mailboxes;

  const filtered = merged
    .filter((m) => statusFilter === 'all' || m.status === statusFilter)
    .filter((m) => (m.from_email || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] || 0;
      const bv = b[sort.key] || 0;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const totalSent        = merged.reduce((s, m) => s + (m.sent || 0), 0);
  const totalReplied     = merged.reduce((s, m) => s + (m.replied || 0), 0);
  const totalBounced     = merged.reduce((s, m) => s + (m.bounced || 0), 0);
  const activeCount      = merged.filter((m) => m.status === 'active').length;
  const inactiveCount    = merged.filter((m) => m.status === 'inactive').length;
  const disconnectedCount = merged.filter((m) => m.status === 'disconnected').length;

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Mailbox Health</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {healthLoading ? 'Loading…' : `${merged.length} mailboxes`}
          </p>
        </div>
        <DateFilter startDate={startDate} endDate={endDate} onChange={onDateChange} />
      </div>

      {/* Summary stats */}
      {healthLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, height: 88, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Mailboxes', value: merged.length, sub: null, statusPills: true },
            { label: 'Total Sent', value: totalSent.toLocaleString(), sub: 'emails sent' },
            { label: 'Total Replies', value: totalReplied.toLocaleString(), sub: totalSent > 0 ? `${Math.round((totalReplied / totalSent) * 100)}% reply rate` : '' },
            { label: 'Total Bounced', value: totalBounced.toLocaleString(), sub: totalSent > 0 ? `${Math.round((totalBounced / totalSent) * 100)}% bounce rate` : '', color: totalBounced > 0 ? 'var(--err-text)' : undefined },
          ].map(({ label, value, sub, color, statusPills }) => (
            <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--text)', letterSpacing: '-0.02em' }}>{value}</div>
              {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
              {statusPills && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {[
                    { key: 'active', label: `${activeCount} active`, color: 'var(--ok-text)', bg: 'var(--ok-bg)' },
                    { key: 'inactive', label: `${inactiveCount} idle`, color: 'var(--warn-text)', bg: 'var(--warn-bg)' },
                    { key: 'disconnected', label: `${disconnectedCount} disconnected`, color: 'var(--err-text)', bg: 'var(--err-bg)' },
                  ].map(({ key, label: pillLabel, color: pillColor, bg }) => (
                    <button
                      key={key}
                      onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
                      style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 20, border: 'none', cursor: 'pointer',
                        background: statusFilter === key ? pillColor : bg,
                        color: statusFilter === key ? 'white' : pillColor,
                        fontWeight: 500, transition: 'all 0.15s',
                      }}
                    >{pillLabel}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Domain breakdown */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>By Sending Domain</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Top domains by volume</div>
          </div>
          <div style={{ padding: '4px 0', maxHeight: 260, overflowY: 'auto' }}>
            {domLoading ? <SectionLoader height={120} /> : domError ? (
              <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--err-text)' }}>{domError}</div>
            ) : domains.length === 0 ? (
              <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>No domain data</div>
            ) : domains.slice(0, 15).map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: i < domains.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{d.domain || 'unknown'}</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{(d.sent || 0).toLocaleString()} sent</span>
                  <span style={{ color: 'var(--ok-text)' }}>{d.reply_rate ? `${Math.round(d.reply_rate * 100) / 100}%` : '0%'} reply</span>
                  <span style={{ color: 'var(--err-text)' }}>{d.bounce_rate ? `${Math.round(d.bounce_rate * 100) / 100}%` : '0%'} bounce</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mailbox table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>All Mailboxes</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Per-mailbox performance metrics</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {statusFilter !== 'all' && (
              <button onClick={() => setStatusFilter('all')} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer' }}>
                Clear filter ×
              </button>
            )}
            <input
              placeholder="Search mailboxes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: 13, padding: '7px 12px', width: 220, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </div>
        </div>
        {(healthLoading || acctLoading) ? <SectionLoader height={160} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {[
                    { key: 'from_email', label: 'Mailbox' },
                    { key: 'status', label: 'Status' },
                    { key: 'sent', label: 'Sent' },
                    { key: 'opened', label: 'Opened' },
                    { key: 'replied', label: 'Replied' },
                    { key: 'reply_rate', label: 'Reply Rate' },
                    { key: 'bounced', label: 'Bounced' },
                    { key: 'bounce_rate', label: 'Bounce Rate' },
                  ].map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => key !== 'from_email' && toggleSort(key)}
                      style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '9px 18px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: key !== 'from_email' ? 'pointer' : 'default' }}
                    >
                      {label} {sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No mailboxes found</td></tr>
                )}
                {filtered.slice(0, 100).map((m, i) => {
                  const bounceRate = m.bounce_rate || 0;
                  const statusType = m.status === 'active' ? 'ok' : m.status === 'disconnected' ? 'err' : 'warn';
                  const statusLabel = m.status === 'active' ? 'Active' : m.status === 'disconnected' ? 'Disconnected' : 'Idle';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.from_email || '—'}</td>
                      <td style={{ padding: '12px 18px' }}><Badge type={statusType}>{statusLabel}</Badge></td>
                      <td style={{ padding: '12px 18px', fontSize: 13 }}>{(m.sent || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 18px', fontSize: 13 }}>{(m.opened || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>{(m.replied || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 18px', fontSize: 13 }}>{m.reply_rate ? `${m.reply_rate}%` : '—'}</td>
                      <td style={{ padding: '12px 18px', fontSize: 13 }}>{(m.bounced || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 18px' }}>
                        <Badge type={rateStatus(bounceRate)}>
                          {bounceRate ? `${bounceRate}%` : '0%'}
                        </Badge>
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
