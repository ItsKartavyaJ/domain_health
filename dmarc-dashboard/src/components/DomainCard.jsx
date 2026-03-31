export default function DomainCard({ domain, score, rate, spf, dkim, total, status, lastReport }) {
  const colors = {
    ok:     { stroke: '#639922', bg: '#EAF3DE', text: '#3B6D11' },
    warn:   { stroke: '#EF9F27', bg: '#FAEEDA', text: '#854F0B' },
    danger: { stroke: '#E24B4A', bg: '#FCEBEB', text: '#A32D2D' },
  };
  const c = colors[status] || colors.ok;
  const dash = Math.round((score / 100) * 113);
  const borderColor = c.stroke;

  return (
    <div style={{
      background: 'var(--card-bg)', border: '0.5px solid var(--border)',
      borderLeft: `3px solid ${borderColor}`, borderRadius: '0 12px 12px 0', padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{domain}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Report {lastReport}</div>
        </div>
        <div style={{ width: 44, height: 44, position: 'relative', flexShrink: 0 }}>
          <svg viewBox="0 0 44 44" width="44" height="44">
            <circle cx="22" cy="22" r="18" fill="none" stroke={c.bg} strokeWidth="4"/>
            <circle cx="22" cy="22" r="18" fill="none" stroke={c.stroke} strokeWidth="4"
              strokeDasharray={`${dash} 113`} strokeDashoffset="28" strokeLinecap="round"/>
          </svg>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)', fontSize: 11, fontWeight: 500,
          }}>{score}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'DMARC pass', val: `${rate}%`, color: c.text },
          { label: 'Emails today', val: total.toLocaleString() },
          { label: 'SPF', val: spf, color: spf === 'Pass' ? '#3B6D11' : spf === 'Partial' ? '#854F0B' : '#A32D2D' },
          { label: 'DKIM', val: dkim, color: dkim === 'Pass' ? '#3B6D11' : '#A32D2D' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: 'var(--surface)', borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: color || 'inherit' }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}