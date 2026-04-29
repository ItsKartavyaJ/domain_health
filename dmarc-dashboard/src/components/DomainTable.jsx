import { useState } from 'react';

const Badge = ({ type, children, title }) => {
  const bg   = { ok: 'var(--ok-bg)',   warn: 'var(--warn-bg)',   err: 'var(--err-bg)',   info: 'var(--info-bg)'   };
  const text = { ok: 'var(--ok-text)', warn: 'var(--warn-text)', err: 'var(--err-text)', info: 'var(--info-text)' };
  return (
    <span title={title} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, fontWeight: 600, background: bg[type], color: text[type], whiteSpace: 'nowrap', cursor: title ? 'help' : 'default' }}>
      {children}
    </span>
  );
};

const COLS = [
  { key: 'domain',   label: 'Domain' },
  { key: 'score',    label: 'Score' },
  { key: 'rate',     label: 'DMARC pass rate' },
  { key: 'spf',      label: 'SPF' },
  { key: 'dkim',     label: 'DKIM' },
  { key: 'total',    label: 'Emails (48h)' },
  { key: 'trend',    label: 'Trend' },
  { key: 'status',   label: 'Status' },
];

const STATUS_ORDER = { ok: 0, warn: 1, err: 2 };
const SPF_ORDER    = { Pass: 0, Partial: 1, Fail: 2 };
const DKIM_ORDER   = { Pass: 0, Fail: 1 };

function colValue(d, key) {
  switch (key) {
    case 'domain': return (d.domain || '').toLowerCase();
    case 'status': return STATUS_ORDER[d.status] ?? 99;
    case 'spf':    return SPF_ORDER[d.spf] ?? 99;
    case 'dkim':   return DKIM_ORDER[d.dkim] ?? 99;
    default:       return d[key] ?? 0;
  }
}

export default function DomainTable({ domains }) {
  const [search, setSearch]     = useState('');
  const [sortCol, setSortCol]   = useState('score');
  const [sortDir, setSortDir]   = useState('desc');

  function handleSort(key) {
    if (sortCol === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(key); setSortDir(key === 'domain' ? 'asc' : 'desc'); }
  }

  const filtered = domains
    .filter((d) => d.domain.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = colValue(a, sortCol);
      const bv = colValue(b, sortCol);
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>All domains</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Full stats for all monitored domains</div>
        </div>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            placeholder="Search domains…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 13, padding: '7px 12px 7px 32px', width: 210, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {COLS.map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  style={{ fontSize: 11, color: sortCol === key ? 'var(--text)' : 'var(--muted)', fontWeight: 600, padding: '9px 18px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', userSelect: 'none' }}
                >
                  {label}{sortCol === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No domains match your search.</td></tr>
            )}
            {filtered.map((d) => {
              const scoreColor = d.status === 'ok' ? 'var(--ok-text)' : d.status === 'warn' ? 'var(--warn-text)' : 'var(--err-text)';
              const barColor   = d.rate > 80 ? '#22C55E' : d.rate > 50 ? '#F59E0B' : '#EF4444';
              return (
                <tr key={d.domain} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 18px', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{d.domain}</td>
                  <td style={{ padding: '12px 18px' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: scoreColor }}>{d.score}</span>
                  </td>
                  <td style={{ padding: '12px 18px', minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: 'var(--surface)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.rate}%`, background: barColor, borderRadius: 99 }}/>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 36, color: scoreColor }}>{d.rate}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 18px' }}>
                    <Badge
                      type={d.spf === 'Pass' ? 'ok' : d.spf === 'Partial' ? 'warn' : 'err'}
                      title={
                        d.spf === 'Pass' ? 'All sending IPs are authorized by your SPF record — no action needed' :
                        d.spf === 'Partial' ? 'Some sending IPs are not covered by your SPF record. Update the DNS TXT record to add missing mail servers.' :
                        'No valid SPF record found. Add a DNS TXT record: v=spf1 include:your-mail-provider.com ~all'
                      }
                    >{d.spf}</Badge>
                  </td>
                  <td style={{ padding: '12px 18px' }}>
                    <Badge
                      type={d.dkim === 'Pass' ? 'ok' : 'err'}
                      title={
                        d.dkim === 'Pass' ? 'Emails are signed with DKIM — recipients can verify they were not altered in transit' :
                        'No DKIM signature found. Add a DKIM TXT record in your DNS provider to authenticate outbound mail.'
                      }
                    >{d.dkim}</Badge>
                  </td>
                  <td style={{ padding: '12px 18px', fontSize: 13, color: 'var(--text)' }}>{d.total.toLocaleString()}</td>
                  <td style={{ padding: '12px 18px', fontSize: 12, fontWeight: 500, color: d.trend > 0 ? 'var(--ok-text)' : d.trend < 0 ? 'var(--err-text)' : 'var(--muted)' }}>
                    {d.trend > 0 ? `▲ ${d.trend}%` : d.trend < 0 ? `▼ ${Math.abs(d.trend)}%` : '—'}
                  </td>
                  <td style={{ padding: '12px 18px' }}><Badge type={d.status === 'ok' ? 'ok' : d.status === 'warn' ? 'warn' : 'err'}>{d.status === 'ok' ? 'Healthy' : d.status === 'warn' ? 'Warning' : 'Critical'}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
