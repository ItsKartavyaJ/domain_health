export default function DateFilter({ startDate, endDate, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>From</label>
      <input
        type="date"
        value={startDate}
        onChange={(e) => onChange(e.target.value, endDate)}
        style={{
          fontSize: 13, padding: '6px 10px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--surface)',
          color: 'var(--text)',
        }}
      />
      <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>To</label>
      <input
        type="date"
        value={endDate}
        onChange={(e) => onChange(startDate, e.target.value)}
        style={{
          fontSize: 13, padding: '6px 10px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--surface)',
          color: 'var(--text)',
        }}
      />
    </div>
  );
}
