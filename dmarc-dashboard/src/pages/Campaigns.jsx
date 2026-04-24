import { useEffect, useState, useRef } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import DateFilter from '../components/DateFilter';
import Badge from '../components/Badge';
import SectionLoader from '../components/SectionLoader';
import { getCampaignStats, getDailyStats } from '../api/smartlead';
import { TODAY, THIRTY_DAYS_AGO } from '../utils/dates';

export default function Campaigns() {
  const [startDate, setStartDate] = useState(THIRTY_DAYS_AGO);
  const [endDate, setEndDate]     = useState(TODAY);

  const [campaigns, setCampaigns] = useState([]);
  const [daily, setDaily]         = useState([]);

  const [campLoading, setCL]  = useState(true);
  const [dailyLoading, setDL] = useState(true);
  const [campError, setCE]    = useState(null);
  const [dailyError, setDE]   = useState(null);

  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort]             = useState({ key: 'sent', dir: 'desc' });

  const fetchId = useRef(0);

  function fetchAll(s, e) {
    const id = ++fetchId.current;
    setCL(true); setDL(true);
    setCE(null); setDE(null);

    getCampaignStats(s, e)
      .then((d) => { if (fetchId.current === id) setCampaigns(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setCE(err.message); })
      .finally(() => { if (fetchId.current === id) setCL(false); });

    getDailyStats(s, e)
      .then((d) => { if (fetchId.current === id) setDaily(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setDE(err.message); })
      .finally(() => { if (fetchId.current === id) setDL(false); });
  }

  useEffect(() => { fetchAll(THIRTY_DAYS_AGO, TODAY); }, []);

  function onDateChange(s, e) {
    setStartDate(s);
    setEndDate(e);
    fetchAll(s, e);
  }

  function toggleSort(key) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }

  const filtered = campaigns
    .filter((c) => statusFilter === 'all' || c.status === statusFilter)
    .filter((c) => (c.campaign_name || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] || 0;
      const bv = b[sort.key] || 0;
      return sort.dir === 'desc' ? bv - av : av - bv;
    });

  const totalSent     = campaigns.reduce((s, c) => s + (c.sent || 0), 0);
  const totalOpened   = campaigns.reduce((s, c) => s + (c.opened || 0), 0);
  const totalReplied  = campaigns.reduce((s, c) => s + (c.replied || 0), 0);
  const totalPositive = campaigns.reduce((s, c) => s + (c.positive_replied || 0), 0);

  const funnelData = [
    { name: 'Sent', value: totalSent, fill: '#3B82F6' },
    { name: 'Opened', value: totalOpened, fill: '#8B5CF6' },
    { name: 'Replied', value: totalReplied, fill: '#F59E0B' },
    { name: 'Positive', value: totalPositive, fill: '#22C55E' },
  ];

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Campaigns</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {campLoading ? 'Loading…' : `${campaigns.length} campaigns`}
          </p>
        </div>
        <DateFilter startDate={startDate} endDate={endDate} onChange={onDateChange} />
      </div>

      {/* Funnel + Daily activity — independent */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12, marginBottom: 28 }}>
        {/* Funnel */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Campaign Funnel</div>
          {campLoading ? <SectionLoader height={240} /> : campError ? (
            <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--err-text)', fontSize: 13 }}>{campError}</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: 'var(--text)' }} width={70} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} cursor={{ fill: 'var(--surface)', opacity: 0.5 }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
                    {funnelData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
                {funnelData.map((f) => (
                  <div key={f.name} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{f.name}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: f.fill }}>{f.value.toLocaleString()}</div>
                    {totalSent > 0 && f.name !== 'Sent' && (
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{Math.round((f.value / totalSent) * 100)}%</div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Daily activity */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Daily Email Activity</div>
          {dailyLoading ? <SectionLoader height={290} /> : dailyError ? (
            <div style={{ height: 290, display: 'grid', placeItems: 'center', color: 'var(--err-text)', fontSize: 13 }}>{dailyError}</div>
          ) : daily.length > 0 ? (
            <ResponsiveContainer width="100%" height={290}>
              <AreaChart data={daily.map((d) => ({
                date: d.date || '',
                sent: d.sent || 0,
                opened: d.opened || 0,
                replied: d.replied || 0,
              }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} cursor={{ stroke: 'var(--border)' }} />
                <Area type="monotone" dataKey="sent" stroke="#3B82F6" fill="var(--info-bg)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} name="Sent" />
                <Area type="monotone" dataKey="opened" stroke="#8B5CF6" fill="rgba(139,92,246,0.1)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} name="Opened" />
                <Area type="monotone" dataKey="replied" stroke="#22C55E" fill="var(--ok-bg)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} name="Replied" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 290, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No daily data</div>
          )}
        </div>
      </div>

      {/* Campaign table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>All Campaigns</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Performance metrics per campaign</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ fontSize: 13, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            >
              <option value="all">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="COMPLETED">Completed</option>
              <option value="DRAFTED">Drafted</option>
            </select>
            <input
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: 13, padding: '7px 12px', width: 220, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            />
          </div>
        </div>
        {campLoading ? <SectionLoader height={160} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {[
                    { key: 'campaign_name', label: 'Campaign' },
                    { key: 'sent', label: 'Sent' },
                    { key: 'opened', label: 'Opened' },
                    { key: 'open_rate', label: 'Open Rate' },
                    { key: 'replied', label: 'Replied' },
                    { key: 'reply_rate', label: 'Reply Rate' },
                    { key: 'positive_replied', label: 'Positive' },
                    { key: 'bounced', label: 'Bounced' },
                    { key: 'bounce_rate', label: 'Bounce Rate' },
                  ].map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => key !== 'campaign_name' && toggleSort(key)}
                      style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '9px 14px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: key !== 'campaign_name' ? 'pointer' : 'default' }}
                    >
                      {label}{sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No campaigns found</td></tr>
                )}
                {filtered.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaign_name || `Campaign ${c.campaign_id || i}`}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{(c.sent || 0).toLocaleString()}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{(c.opened || 0).toLocaleString()}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{c.open_rate ? `${Math.round(c.open_rate * 100) / 100}%` : '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>{(c.replied || 0).toLocaleString()}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{c.reply_rate ? `${Math.round(c.reply_rate * 100) / 100}%` : '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#22C55E' }}>{c.positive_replied || 0}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>{(c.bounced || 0).toLocaleString()}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <Badge type={(c.bounce_rate || 0) > 3 ? 'err' : (c.bounce_rate || 0) > 1 ? 'warn' : 'ok'}>
                        {c.bounce_rate ? `${Math.round(c.bounce_rate * 100) / 100}%` : '0%'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
