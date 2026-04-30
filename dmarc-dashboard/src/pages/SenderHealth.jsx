import { useEffect, useState } from 'react';
import Badge from '../components/Badge';
import { getSenderHealth } from '../api/influx';

function Sparkline({ values, width = 80, height = 28 }) {
  if (!values || values.length < 2) return <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const color = last >= prev ? 'var(--ok-text)' : 'var(--err-text)';
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SortIcon({ active, dir }) {
  if (!active) return <span style={{ color: 'var(--border)', marginLeft: 3 }}>⇅</span>;
  return <span style={{ marginLeft: 3 }}>{dir === 'desc' ? '▼' : '▲'}</span>;
}

function WarmupBadge({ status }) {
  const s = String(status || '').toLowerCase();
  if (s === 'active' || s === 'enabled' || s === 'true' || s === '1') return <Badge type="ok">Active</Badge>;
  if (s === 'paused' || s === 'false' || s === '0') return <Badge type="warn">Paused</Badge>;
  return <span style={{ fontSize: 12, color: 'var(--muted)' }}>{status || '—'}</span>;
}

function MailboxTable({ mailboxes }) {
  if (!mailboxes || mailboxes.length === 0) {
    return (
      <div style={{ padding: '12px 20px 14px 44px', fontSize: 12, color: 'var(--muted)' }}>
        No per-mailbox data available yet.
      </div>
    );
  }
  return (
    <div style={{ padding: '0 0 4px 44px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead>
          <tr style={{ background: 'var(--bg)' }}>
            {['Mailbox', 'Sent', 'Inbox %', 'Spam %', 'Bounce %', 'Health', 'Warmup'].map((h) => (
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
            const bounceType = m.bounce_rate <= 2 ? 'ok' : m.bounce_rate <= 5 ? 'warn' : 'err';
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text)' }}>{m.email}</td>
                <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--muted)' }}>{m.sent_count.toLocaleString()}</td>
                <td style={{ padding: '9px 12px' }}><Badge type={m.inbox_pct >= 80 ? 'ok' : 'warn'}>{m.inbox_pct.toFixed(1)}%</Badge></td>
                <td style={{ padding: '9px 12px' }}><Badge type={spamType}>{m.spam_pct.toFixed(1)}%</Badge></td>
                <td style={{ padding: '9px 12px' }}><Badge type={bounceType}>{m.bounce_rate.toFixed(1)}%</Badge></td>
                <td style={{ padding: '9px 12px' }}><Badge type={healthType}>{m.health_score}</Badge></td>
                <td style={{ padding: '9px 12px' }}><WarmupBadge status={m.warmup_status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const GRID = '1fr 80px 90px 90px 90px 90px 90px 32px';

function DomainRow({ d, last }) {
  const [open, setOpen] = useState(false);

  const replyType = d.reply_rate >= 10 ? 'ok' : d.reply_rate >= 5 ? 'warn' : 'err';
  const bounceType = d.bounce_rate <= 2 ? 'ok' : d.bounce_rate <= 5 ? 'warn' : 'err';
  const posReplyType = d.positive_reply_rate >= 5 ? 'ok' : d.positive_reply_rate >= 2 ? 'warn' : 'err';
  const spamType = (d.spam_pct || 0) <= 1 ? 'ok' : (d.spam_pct || 0) <= 3 ? 'warn' : 'err';

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '13px 18px', cursor: 'pointer', userSelect: 'none', gap: 8 }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.domain}
          {d.mailboxes.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>{d.mailboxes.length} mailbox{d.mailboxes.length !== 1 ? 'es' : ''}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(d.sent_count || 0).toLocaleString()}</div>
        <div><Badge type={replyType}>{d.reply_rate.toFixed(1)}%</Badge></div>
        <div><Badge type={bounceType}>{d.bounce_rate.toFixed(1)}%</Badge></div>
        <div>
          {d.positive_reply_rate > 0
            ? <Badge type={posReplyType}>{d.positive_reply_rate.toFixed(1)}%</Badge>
            : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
          }
        </div>
        <div>
          {(d.open_rate || 0) > 0
            ? <span style={{ fontSize: 12, color: 'var(--text)' }}>{d.open_rate.toFixed(1)}%</span>
            : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
          }
        </div>
        <div>
          {(d.spam_pct || 0) > 0
            ? <Badge type={spamType}>{d.spam_pct.toFixed(1)}%</Badge>
            : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
          }
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
      {open && <MailboxTable mailboxes={d.mailboxes} />}
    </div>
  );
}

const SORT_KEYS = ['sent_count', 'reply_rate', 'bounce_rate', 'positive_reply_rate', 'open_rate', 'spam_pct'];

export default function SenderHealth() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'reply_rate', dir: 'desc' });

  useEffect(() => {
    getSenderHealth()
      .then((d) => setDomains(Array.isArray(d) ? d : []))
      .catch(() => setDomains([]))
      .finally(() => setLoading(false));
  }, []);

  function toggleSort(key) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const filtered = domains
    .filter((d) => (d.domain || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] ?? 0;
      const bv = b[sort.key] ?? 0;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const avgReply = domains.length
    ? (domains.reduce((s, d) => s + d.reply_rate, 0) / domains.length).toFixed(1)
    : null;
  const avgBounce = domains.length
    ? (domains.reduce((s, d) => s + d.bounce_rate, 0) / domains.length).toFixed(1)
    : null;
  const avgPosReply = domains.length
    ? (domains.reduce((s, d) => s + d.positive_reply_rate, 0) / domains.length).toFixed(1)
    : null;
  const totalSent = domains.reduce((s, d) => s + d.sent_count, 0);

  const columns = [
    { key: 'domain', label: 'Domain', sortable: false },
    { key: 'sent_count', label: 'Sent', sortable: true },
    { key: 'reply_rate', label: 'Reply %', sortable: true },
    { key: 'bounce_rate', label: 'Bounce %', sortable: true },
    { key: 'positive_reply_rate', label: 'Pos. Reply', sortable: true },
    { key: 'open_rate', label: 'Open %', sortable: true },
    { key: 'spam_pct', label: 'Spam %', sortable: true },
    { key: '_expand', label: '', sortable: false },
  ];

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Sender Health</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading…' : `${domains.length} domain${domains.length !== 1 ? 's' : ''} · ${totalSent.toLocaleString()} emails sent (last 48h)`}
          </p>
        </div>
        <input
          placeholder="Search domains..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: '7px 12px', width: 220, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
        />
      </div>

      {!loading && domains.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Domains', value: domains.length },
            { label: 'Avg Reply Rate', value: avgReply != null ? `${avgReply}%` : '—', color: avgReply == null ? undefined : avgReply >= 10 ? 'var(--ok-text)' : avgReply >= 5 ? 'var(--warn-text)' : 'var(--err-text)' },
            { label: 'Avg Bounce Rate', value: avgBounce != null ? `${avgBounce}%` : '—', color: avgBounce == null ? undefined : avgBounce <= 2 ? 'var(--ok-text)' : avgBounce <= 5 ? 'var(--warn-text)' : 'var(--err-text)' },
            { label: 'Avg Positive Reply', value: avgPosReply != null ? `${avgPosReply}%` : '—', color: avgPosReply == null ? undefined : avgPosReply >= 5 ? 'var(--ok-text)' : avgPosReply >= 2 ? 'var(--warn-text)' : 'var(--err-text)' },
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
          <div style={{ height: 160, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        ) : domains.length === 0 ? (
          <div style={{ padding: '48px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No sender health data yet. Data appears after the next Smartlead health poll.
          </div>
        ) : (
          <>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: GRID,
              padding: '9px 18px', gap: 8,
              background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            }}>
              {columns.map(({ key, label, sortable }) => (
                <div
                  key={key}
                  onClick={() => sortable && toggleSort(key)}
                  style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}
                >
                  {label}{sortable && <SortIcon active={sort.key === key} dir={sort.dir} />}
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
