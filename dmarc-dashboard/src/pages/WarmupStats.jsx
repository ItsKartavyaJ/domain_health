import { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Badge from '../components/Badge';
import SectionLoader from '../components/SectionLoader';
import { getWarmupStats } from '../api/influx';

const RANGE_OPTIONS = [
  { label: '7d', value: '-7d' },
  { label: '14d', value: '-14d' },
  { label: '30d', value: '-30d' },
  { label: '90d', value: '-90d' },
];

function RangeFilter({ range, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {RANGE_OPTIONS.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${range === value ? 'var(--accent)' : 'var(--border)'}`,
            background: range === value ? 'var(--accent)' : 'var(--surface)',
            color: range === value ? '#fff' : 'var(--muted)',
            cursor: 'pointer', fontWeight: 500,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function MailboxTable({ mailboxes }) {
  if (!mailboxes || mailboxes.length === 0) {
    return (
      <div style={{ padding: '12px 20px 14px 44px', fontSize: 12, color: 'var(--muted)' }}>
        No per-mailbox data available.
      </div>
    );
  }
  return (
    <div style={{ padding: '0 0 4px 44px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead>
          <tr style={{ background: 'var(--bg)' }}>
            {['Mailbox', 'Sent (7d)', 'Inbox %', 'Spam %', 'Health Score', 'Warmup'].map((h) => (
              <th key={h} style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, padding: '6px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mailboxes.map((m, i) => {
            const healthType = m.health_score >= 80 ? 'ok' : m.health_score >= 60 ? 'warn' : 'err';
            const spamType = m.spam_pct <= 1 ? 'ok' : m.spam_pct <= 3 ? 'warn' : 'err';
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text)' }}>{m.email}</td>
                <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--muted)' }}>{(m.total_sent || 0).toLocaleString()}</td>
                <td style={{ padding: '9px 12px' }}>
                  <Badge type={m.inbox_pct >= 80 ? 'ok' : 'warn'}>{m.inbox_pct.toFixed(1)}%</Badge>
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <Badge type={spamType}>{m.spam_pct.toFixed(1)}%</Badge>
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <Badge type={healthType}>{m.health_score}</Badge>
                </td>
                <td style={{ padding: '9px 12px' }}>
                  {m.warmup_enabled
                    ? <Badge type="ok">Active</Badge>
                    : <Badge type="warn">Paused</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TrendChart({ trendHealth, trendSpam }) {
  if (!trendHealth?.length && !trendSpam?.length) return null;

  // Merge health + spam by date
  const dateMap = {};
  for (const p of (trendHealth || [])) {
    if (!dateMap[p.date]) dateMap[p.date] = { date: p.date };
    dateMap[p.date].health = p.value;
  }
  for (const p of (trendSpam || [])) {
    if (!dateMap[p.date]) dateMap[p.date] = { date: p.date };
    dateMap[p.date].spam = p.value;
  }
  const data = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  if (data.length < 2) return null;

  const fmtDate = (d) => {
    const parts = d.split('-');
    return `${parts[1]}/${parts[2]}`;
  };

  return (
    <div style={{ padding: '8px 20px 16px 44px' }}>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={32} domain={[0, 100]} />
          <Tooltip
            contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--muted)' }}
            labelFormatter={fmtDate}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Line type="monotone" dataKey="health" stroke="var(--ok-text)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} name="Health Score" />
          <Line type="monotone" dataKey="spam" stroke="var(--err-text)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} name="Spam %" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DomainRow({ d, last }) {
  const [open, setOpen] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const hasTrend = (d.trend_health?.length >= 2) || (d.trend_spam?.length >= 2);

  const healthType = d.avg_health >= 80 ? 'ok' : d.avg_health >= 60 ? 'warn' : 'err';
  const spamType = d.avg_spam_pct <= 1 ? 'ok' : d.avg_spam_pct <= 3 ? 'warn' : 'err';

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 100px 100px 110px 32px', alignItems: 'center', padding: '13px 18px', cursor: 'pointer', userSelect: 'none', gap: 8 }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.domain}
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>
            {d.enabled_count}/{d.total_mailboxes} warming
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <Badge type={healthType}>{d.avg_health}</Badge>
        </div>
        <div><Badge type={spamType}>{d.avg_spam_pct.toFixed(1)}%</Badge></div>
        <div>
          <Badge type={d.avg_inbox_pct >= 80 ? 'ok' : 'warn'}>{d.avg_inbox_pct.toFixed(1)}%</Badge>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.total_mailboxes}</div>
        <div>
          {d.enabled_count === 0 ? (
            <Badge type="warn">All paused</Badge>
          ) : d.enabled_count < d.total_mailboxes ? (
            <Badge type="warn">{d.total_mailboxes - d.enabled_count} paused</Badge>
          ) : (
            <Badge type="ok">All active</Badge>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--muted)' }}
          >
            <polyline points="2,4 6,8 10,4" />
          </svg>
        </div>
      </div>

      {open && (
        <>
          {hasTrend && (
            <div style={{ padding: '4px 20px 0 44px' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowChart((c) => !c); }}
                style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}
              >
                {showChart ? '▲ Hide trend' : '▼ Show health/spam trend'}
              </button>
            </div>
          )}
          {showChart && hasTrend && <TrendChart trendHealth={d.trend_health} trendSpam={d.trend_spam} />}
          <MailboxTable mailboxes={d.mailboxes} />
        </>
      )}
    </div>
  );
}

const SORT_KEYS = ['avg_health', 'avg_spam_pct', 'avg_inbox_pct', 'total_mailboxes', 'enabled_count'];

export default function WarmupStats() {
  const [range, setRange] = useState('-30d');
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'avg_health', dir: 'desc' });
  const fetchId = useRef(0);

  function fetchData(r) {
    const id = ++fetchId.current;
    setLoading(true);
    setError(null);
    getWarmupStats(r)
      .then((d) => { if (fetchId.current === id) setDomains(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setError(err.message); })
      .finally(() => { if (fetchId.current === id) setLoading(false); });
  }

  useEffect(() => { fetchData('-30d'); }, []);

  function onRangeChange(r) {
    setRange(r);
    fetchData(r);
  }

  function toggleSort(key) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const filtered = domains
    .filter((d) => (d.domain || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] ?? -1;
      const bv = b[sort.key] ?? -1;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const totalMailboxes = domains.reduce((s, d) => s + d.total_mailboxes, 0);
  const enabledMailboxes = domains.reduce((s, d) => s + d.enabled_count, 0);
  const avgHealth = domains.length
    ? Math.round(domains.reduce((s, d) => s + d.avg_health, 0) / domains.length)
    : null;
  const avgSpam = domains.length
    ? (domains.reduce((s, d) => s + d.avg_spam_pct, 0) / domains.length).toFixed(1)
    : null;

  const columns = [
    { key: 'domain', label: 'Domain', sortable: false },
    { key: 'avg_health', label: 'Avg Health', sortable: true },
    { key: 'avg_spam_pct', label: 'Avg Spam %', sortable: true },
    { key: 'avg_inbox_pct', label: 'Avg Inbox %', sortable: true },
    { key: 'total_mailboxes', label: 'Mailboxes', sortable: true },
    { key: 'enabled_count', label: 'Status', sortable: true },
    { key: '_expand', label: '', sortable: false },
  ];

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Warmup Stats</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading…' : `${domains.length} domain${domains.length !== 1 ? 's' : ''} · ${enabledMailboxes} of ${totalMailboxes} mailboxes warming`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <RangeFilter range={range} onChange={onRangeChange} />
          <input
            placeholder="Search domains..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 13, padding: '7px 12px', width: 200, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
      </div>

      {!loading && domains.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Domains', value: domains.length },
            { label: 'Mailboxes warming', value: `${enabledMailboxes} / ${totalMailboxes}` },
            {
              label: 'Avg health score', value: avgHealth != null ? `${avgHealth}` : '—',
              color: avgHealth == null ? undefined : avgHealth >= 80 ? 'var(--ok-text)' : avgHealth >= 60 ? 'var(--warn-text)' : 'var(--err-text)',
            },
            {
              label: 'Avg spam rate', value: avgSpam != null ? `${avgSpam}%` : '—',
              color: avgSpam == null ? undefined : Number(avgSpam) <= 1 ? 'var(--ok-text)' : Number(avgSpam) <= 3 ? 'var(--warn-text)' : 'var(--err-text)',
            },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--text)', letterSpacing: '-0.02em' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <SectionLoader height={200} />
        ) : error ? (
          <div style={{ padding: '48px 18px', textAlign: 'center', color: 'var(--err-text)', fontSize: 13 }}>{error}</div>
        ) : domains.length === 0 ? (
          <div style={{ padding: '48px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No warmup data found for this period. Data appears after the next warmup stats poll.
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 100px 100px 100px 100px 110px 32px',
              padding: '9px 18px', gap: 8,
              background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            }}>
              {columns.map(({ key, label, sortable }) => (
                <div
                  key={key}
                  onClick={() => sortable && toggleSort(key)}
                  style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}
                >
                  {label}{sortable && sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : (sortable ? ' ⇅' : '')}
                </div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No domains match your search.</div>
            ) : (
              filtered.map((d, i) => (
                <DomainRow key={d.domain} d={d} last={i === filtered.length - 1} />
              ))
            )}
          </>
        )}
      </div>
    </main>
  );
}
