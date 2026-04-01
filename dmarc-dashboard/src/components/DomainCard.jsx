export default function DomainCard({ domain, score, rate, spf, dkim, total, status, lastReport }) {
  const accent = status === 'ok' ? '#22C55E' : status === 'warn' ? '#F59E0B' : '#EF4444';
  const accentBg = status === 'ok' ? 'var(--ok-bg)' : status === 'warn' ? 'var(--warn-bg)' : 'var(--err-bg)';
  const accentText = status === 'ok' ? 'var(--ok-text)' : status === 'warn' ? 'var(--warn-text)' : 'var(--err-text)';
  const dash = Math.round((score / 100) * 113);

  const spfColor = spf === 'Pass' ? 'var(--ok-text)' : spf === 'Partial' ? 'var(--warn-text)' : 'var(--err-text)';
  const dkimColor = dkim === 'Pass' ? 'var(--ok-text)' : 'var(--err-text)';

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--border)',
      borderTop: `3px solid ${accent}`,
      borderRadius: 12,
      padding: 18,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      transition: 'box-shadow 0.15s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{domain}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Report {lastReport}</div>
        </div>
        {/* Score ring */}
        <div style={{ position: 'relative', width: 46, height: 46, flexShrink: 0, marginLeft: 8 }}>
          <svg viewBox="0 0 46 46" width="46" height="46">
            <circle cx="23" cy="23" r="19" fill="none" stroke={accentBg} strokeWidth="4.5"/>
            <circle cx="23" cy="23" r="19" fill="none" stroke={accent} strokeWidth="4.5"
              strokeDasharray={`${dash} 119`} strokeDashoffset="30" strokeLinecap="round"/>
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: accentText }}>
            {score}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'DMARC pass', val: `${rate}%`, color: accentText },
          { label: 'Emails', val: total.toLocaleString(), color: 'var(--text)' },
          { label: 'SPF', val: spf, color: spfColor },
          { label: 'DKIM', val: dkim, color: dkimColor },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
