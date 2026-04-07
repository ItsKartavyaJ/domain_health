export default function Badge({ type, children }) {
  const bg = { ok: 'var(--ok-bg)', warn: 'var(--warn-bg)', err: 'var(--err-bg)' };
  const text = { ok: 'var(--ok-text)', warn: 'var(--warn-text)', err: 'var(--err-text)' };
  return (
    <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, fontWeight: 600, background: bg[type], color: text[type], whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}
