export default function SectionLoader({ height = 200 }) {
  return (
    <div style={{ height, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
  );
}
