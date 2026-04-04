import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import DateFilter from '../components/DateFilter';
import { getMailboxHealth, getDomainHealth, getProviderStats } from '../api/smartlead';

const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

function Badge({ type, children }) {
  const bg = { ok: 'var(--ok-bg)', warn: 'var(--warn-bg)', err: 'var(--err-bg)' };
  const text = { ok: 'var(--ok-text)', warn: 'var(--warn-text)', err: 'var(--err-text)' };
  return (
    <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, fontWeight: 600, background: bg[type], color: text[type], whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function rateStatus(rate) {
  if (rate > 3) return 'err';
  if (rate > 1) return 'warn';
  return 'ok';
}

export default function Mailboxes() {
  const [startDate, setStartDate] = useState(THIRTY_DAYS_AGO);
  const [endDate, setEndDate] = useState(TODAY);
  const [mailboxes, setMailboxes] = useState([]);
  const [domains, setDomains] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'sent', dir: 'desc' });

  useEffect(() => {
    Promise.all([
      getMailboxHealth(THIRTY_DAYS_AGO, TODAY),
      getDomainHealth(THIRTY_DAYS_AGO, TODAY),
      getProviderStats(THIRTY_DAYS_AGO, TODAY),
    ])
      .then(([m, d, p]) => {
        setMailboxes(Array.isArray(m) ? m : []);
        setDomains(Array.isArray(d) ? d : []);
        setProviders(Array.isArray(p) ? p : []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function onDateChange(s, e) {
    setStartDate(s);
    setEndDate(e);
    setLoading(true);
    setError(null);
    Promise.all([
      getMailboxHealth(s, e),
      getDomainHealth(s, e),
      getProviderStats(s, e),
    ])
      .then(([m, d, p]) => {
        setMailboxes(Array.isArray(m) ? m : []);
        setDomains(Array.isArray(d) ? d : []);
        setProviders(Array.isArray(p) ? p : []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function toggleSort(key) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const filtered = mailboxes
    .filter((m) => (m.from_email || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] || 0;
      const bv = b[sort.key] || 0;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const totalSent = mailboxes.reduce((s, m) => s + (m.sent || 0), 0);
  const totalReplied = mailboxes.reduce((s, m) => s + (m.replied || 0), 0);
  const totalBounced = mailboxes.reduce((s, m) => s + (m.bounced || 0), 0);

  if (error) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: 'var(--err-bg)', color: 'var(--err-text)', borderRadius: 10, padding: '14px 20px', fontSize: 13 }}>{error}</div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Mailbox Health</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading...' : `${mailboxes.length} mailboxes`}
          </p>
        </div>
        <DateFilter startDate={startDate} endDate={endDate} onChange={onDateChange} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', height: 200, alignItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading mailbox data...</div>
      ) : (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 28 }}>
            {[
              { label: 'Mailboxes', value: mailboxes.length, sub: 'active accounts' },
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

          {/* Provider + Domain breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
            {/* Provider chart */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>By Email Provider</div>
              {providers.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={providers.map((p) => ({ name: p.email_provider || 'Unknown', sent: p.sent || 0, replied: p.replied || 0, bounced: p.bounced || 0 }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="sent" fill="#3B82F6" name="Sent" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="replied" fill="#22C55E" name="Replied" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="bounced" fill="#EF4444" name="Bounced" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: 220, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No provider data</div>
              )}
            </div>

            {/* Domain breakdown */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>By Sending Domain</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Top domains by volume</div>
              </div>
              <div style={{ padding: '4px 0', maxHeight: 260, overflowY: 'auto' }}>
                {domains.slice(0, 15).map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: i < domains.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{d.domain || 'unknown'}</div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                      <span style={{ color: 'var(--muted)' }}>{(d.sent || 0).toLocaleString()} sent</span>
                      <span style={{ color: 'var(--ok-text)' }}>{d.reply_rate ? `${Math.round(d.reply_rate * 100) / 100}%` : '0%'} reply</span>
                      <span style={{ color: 'var(--err-text)' }}>{d.bounce_rate ? `${Math.round(d.bounce_rate * 100) / 100}%` : '0%'} bounce</span>
                    </div>
                  </div>
                ))}
                {domains.length === 0 && (
                  <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>No domain data</div>
                )}
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
              <input
                placeholder="Search mailboxes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: 13, padding: '7px 12px', width: 220, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    {[
                      { key: 'from_email', label: 'Mailbox' },
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
                    <tr><td colSpan={7} style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No mailboxes found</td></tr>
                  )}
                  {filtered.slice(0, 100).map((m, i) => {
                    const bounceRate = m.bounce_rate || 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.from_email || '—'}</td>
                        <td style={{ padding: '12px 18px', fontSize: 13 }}>{(m.sent || 0).toLocaleString()}</td>
                        <td style={{ padding: '12px 18px', fontSize: 13 }}>{(m.opened || 0).toLocaleString()}</td>
                        <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>{(m.replied || 0).toLocaleString()}</td>
                        <td style={{ padding: '12px 18px', fontSize: 13 }}>{m.reply_rate ? `${Math.round(m.reply_rate * 100) / 100}%` : '—'}</td>
                        <td style={{ padding: '12px 18px', fontSize: 13 }}>{(m.bounced || 0).toLocaleString()}</td>
                        <td style={{ padding: '12px 18px' }}>
                          <Badge type={rateStatus(bounceRate)}>
                            {bounceRate ? `${Math.round(bounceRate * 100) / 100}%` : '0%'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
