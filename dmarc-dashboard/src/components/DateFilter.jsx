const PRESETS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function DateFilter({ startDate, endDate, onChange }) {
  function applyPreset(days) {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    onChange(start, end);
  }

  const activePreset = PRESETS.find(({ days }) => {
    const expected = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    return startDate === expected && endDate === today;
  });

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {PRESETS.map(({ label, days }) => {
        const active = activePreset?.days === days;
        return (
          <button
            key={label}
            onClick={() => applyPreset(days)}
            style={{
              fontSize: 12, padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              background: active ? 'var(--accent)' : 'var(--surface)',
              color: active ? '#fff' : 'var(--muted)',
              cursor: 'pointer', fontWeight: 500,
            }}
          >
            {label}
          </button>
        );
      })}
      <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
      <input
        type="date"
        value={startDate}
        max={endDate}
        onChange={(e) => e.target.value <= endDate && onChange(e.target.value, endDate)}
        style={{
          fontSize: 12, padding: '5px 8px', borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--surface)',
          color: 'var(--text)',
        }}
      />
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>→</span>
      <input
        type="date"
        value={endDate}
        min={startDate}
        onChange={(e) => e.target.value >= startDate && onChange(startDate, e.target.value)}
        style={{
          fontSize: 12, padding: '5px 8px', borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--surface)',
          color: 'var(--text)',
        }}
      />
    </div>
  );
}
