import { useEffect, useState } from 'react';
import DomainCard from '../components/DomainCard';
import DomainTable from '../components/DomainTable';
import { getDomainStats, getAlerts } from '../api/influx';


export default function Overview() {
  const [domains, setDomains] = useState([]);
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    Promise.all([getDomainStats(), getAlerts()])
      .then(([d, a]) => { setDomains(d); setAlerts(a); })
      .catch((err) => { console.error(err); setError('Failed to load data — check API connection.'); })
      .finally(() => setLoading(false));
  }, []);

  const dotColor = { red: '#E24B4A', amber: '#EF9F27', green: '#639922' };

  if (error) {
    return (
      <div style={{ padding: 24, color: '#E24B4A' }}>{error}</div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500 }}>Overview</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {loading ? 'Loading...' : `Last updated just now · ${domains.length} domains monitored`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--card-bg)', color: 'inherit', cursor: 'pointer' }}>Export report</button>
          <button style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', cursor: 'pointer' }}>+ Add domain</button>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Domain health</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
        {domains.slice(0, 3).map(d => <DomainCard key={d.domain} {...d} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: 'var(--card-bg)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Recent alerts</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Issues that need your attention</div>
          {alerts.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < alerts.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor[a.type], marginTop: 4, flexShrink: 0 }}/>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{a.message}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{a.desc}</div>
                {a.type !== 'green' && (
                  <div style={{ fontSize: 12, color: '#185FA5', marginTop: 4, cursor: 'pointer' }}
                    onClick={() => window.sendPrompt?.(`How do I fix ${a.message}?`)}>
                    How do I fix this? ↗
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--card-bg)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Report status</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>When each domain last received a report</div>
          {domains.map(d => (
            <div key={d.domain} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13 }}>{d.domain}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{d.lastReport}</div>
              </div>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 500,
                background: d.status === 'ok' ? '#EAF3DE' : d.status === 'warn' ? '#FAEEDA' : '#FCEBEB',
                color:      d.status === 'ok' ? '#27500A' : d.status === 'warn' ? '#633806' : '#791F1F' }}>
                {d.status === 'ok' ? 'Fresh' : d.status === 'warn' ? 'Stale' : 'Error'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>All domains</div>
      <DomainTable domains={domains} />
    </div>
  );
}