import { useState } from 'react';

const Badge = ({ type, children }) => {
  const styles = {
    ok:    { background: '#EAF3DE', color: '#27500A' },
    warn:  { background: '#FAEEDA', color: '#633806' },
    err:   { background: '#FCEBEB', color: '#791F1F' },
    info:  { background: '#E6F1FB', color: '#0C447C' },
  };
  return (
    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 500, ...styles[type] }}>
      {children}
    </span>
  );
};

export default function DomainTable({ domains }) {
  const [search, setSearch] = useState('');
  const filtered = domains.filter(d => d.domain.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ background: 'var(--card-bg)', border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '0.5px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>All domains</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Full stats for all monitored domains</div>
        </div>
        <input
          placeholder="Search domains..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: '6px 12px', width: 200, borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface)', color: 'inherit' }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['Domain','Health','DMARC pass rate','SPF','DKIM','Emails today','7d trend','Last report','Status'].map(h => (
                <th key={h} style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, padding: '10px 16px', textAlign: 'left', borderBottom: '0.5px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(d => (
              <tr key={d.domain} style={{ borderBottom: '0.5px solid var(--border)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontWeight: 500, fontSize: 13 }}>{d.domain}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.status === 'ok' ? '#639922' : d.status === 'warn' ? '#EF9F27' : '#E24B4A' }}/>
                    <span style={{ fontWeight: 500, fontSize: 13, color: d.status === 'ok' ? '#3B6D11' : d.status === 'warn' ? '#854F0B' : '#A32D2D' }}>{d.score}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: 'var(--surface)', borderRadius: 99 }}>
                      <div style={{ height: 6, borderRadius: 99, width: `${d.rate}%`, background: d.rate > 80 ? '#639922' : d.rate > 50 ? '#EF9F27' : '#E24B4A' }}/>
                    </div>
                    <span style={{ fontSize: 12, minWidth: 36, color: d.rate > 80 ? '#3B6D11' : d.rate > 50 ? '#854F0B' : '#A32D2D' }}>{d.rate}%</span>
                  </div>
                </td>
                <td style={{ padding: '12px 16px' }}><Badge type={d.spf === 'Pass' ? 'ok' : d.spf === 'Partial' ? 'warn' : 'err'}>{d.spf}</Badge></td>
                <td style={{ padding: '12px 16px' }}><Badge type={d.dkim === 'Pass' ? 'ok' : 'err'}>{d.dkim}</Badge></td>
                <td style={{ padding: '12px 16px', fontSize: 13 }}>{d.total.toLocaleString()}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: d.trend > 0 ? '#3B6D11' : d.trend < 0 ? '#A32D2D' : 'var(--muted)' }}>
                  {d.trend > 0 ? `▲ ${d.trend}%` : d.trend < 0 ? `▼ ${Math.abs(d.trend)}%` : '— No data'}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--muted)' }}>{d.lastReport}</td>
                <td style={{ padding: '12px 16px' }}><Badge type={d.status === 'ok' ? 'ok' : d.status === 'warn' ? 'warn' : 'err'}>{d.status === 'ok' ? 'Active' : d.status === 'warn' ? 'Warning' : 'Stale'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}