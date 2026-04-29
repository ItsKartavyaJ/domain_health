import { useEffect, useState, useRef } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import DateFilter from '../components/DateFilter';
import SectionLoader from '../components/SectionLoader';
import { getReplyCategories, getDailyPositiveReplies, getResponseStats } from '../api/smartlead';
import { TODAY, THIRTY_DAYS_AGO } from '../utils/dates';

const COLORS = ['#22C55E', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6B7280'];
const SENTIMENT_COLORS = { positive: '#22C55E', neutral: '#3B82F6', negative: '#EF4444' };

export default function Replies() {
  const [startDate, setStartDate] = useState(THIRTY_DAYS_AGO);
  const [endDate, setEndDate]     = useState(TODAY);

  const [categories, setCategories]     = useState([]);
  const [dailyReplies, setDailyReplies] = useState([]);
  const [responseStats, setResponseStats] = useState([]);

  const [catsLoading, setCL]   = useState(true);
  const [dailyLoading, setDaL] = useState(true);
  const [statsLoading, setSL]  = useState(true);

  const [catsError, setCE]   = useState(null);
  const [dailyError, setDaE] = useState(null);
  const [statsError, setSE]  = useState(null);

  const fetchId = useRef(0);

  function fetchAll(s, e) {
    const id = ++fetchId.current;
    setCL(true); setDaL(true); setSL(true);
    setCE(null); setDaE(null); setSE(null);

    getReplyCategories(s, e)
      .then((d) => { if (fetchId.current === id) setCategories(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setCE(err.message); })
      .finally(() => { if (fetchId.current === id) setCL(false); });

    getDailyPositiveReplies(s, e)
      .then((d) => { if (fetchId.current === id) setDailyReplies(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setDaE(err.message); })
      .finally(() => { if (fetchId.current === id) setDaL(false); });

    getResponseStats(s, e)
      .then((d) => { if (fetchId.current === id) setResponseStats(Array.isArray(d) ? d : []); })
      .catch((err) => { if (fetchId.current === id) setSE(err.message); })
      .finally(() => { if (fetchId.current === id) setSL(false); });
  }

  useEffect(() => { fetchAll(THIRTY_DAYS_AGO, TODAY); }, []);

  function onDateChange(s, e) {
    setStartDate(s);
    setEndDate(e);
    fetchAll(s, e);
  }

  const [sortCol, setSortCol] = useState('total_replies');
  const [sortDir, setSortDir] = useState('desc');

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sortedStats = [...responseStats].sort((a, b) => {
    let av, bv;
    if (sortCol === 'campaign_name') {
      av = (a.campaign_name || '').toLowerCase();
      bv = (b.campaign_name || '').toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    av = a[sortCol] ?? 0;
    bv = b[sortCol] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const totalReplies = categories.reduce((sum, c) => sum + (c.total_response || 0), 0);

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Reply Intelligence</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {catsLoading ? 'Loading…' : `${totalReplies} total replies`}
          </p>
        </div>
        <DateFilter startDate={startDate} endDate={endDate} onChange={onDateChange} />
      </div>

      {/* Category breakdown + pie chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
        {/* Pie chart */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Reply Categories</div>
          {catsLoading ? <SectionLoader height={260} /> : catsError ? (
            <div style={{ height: 260, display: 'grid', placeItems: 'center', color: 'var(--err-text)', fontSize: 13 }}>{catsError}</div>
          ) : categories.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={categories.map((c) => ({ name: c.name || 'Unknown', value: c.total_response || 0 }))}
                  cx="50%" cy="50%" innerRadius={55} outerRadius={95}
                  dataKey="value" paddingAngle={2} strokeWidth={0}
                >
                  {categories.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} labelStyle={{ color: 'var(--text)', fontWeight: 600 }} itemStyle={{ color: 'var(--muted)' }}
                  formatter={(value, name) => [`${value} replies`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 260, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No category data</div>
          )}
        </div>

        {/* Category list */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Breakdown</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Reply sentiment categories</div>
          </div>
          <div style={{ padding: '4px 0' }}>
            {catsLoading ? <SectionLoader height={120} /> : null}
            {!catsLoading && categories.length === 0 && (
              <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>No data yet</div>
            )}
            {categories.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: i < categories.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: SENTIMENT_COLORS[c.sentiment_type] || 'var(--muted)', marginTop: 2 }}>
                      {c.sentiment_type || 'unknown'}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{c.total_response || 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.percentage ? `${Math.round(c.percentage)}%` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Daily positive reply trend */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Daily Positive Reply Trend</div>
        {dailyLoading ? <SectionLoader height={240} /> : dailyError ? (
          <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--err-text)', fontSize: 13 }}>{dailyError}</div>
        ) : dailyReplies.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dailyReplies.map((d) => ({ date: d.date || '', positive: d.positive_replies || 0 }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} labelStyle={{ color: 'var(--text)', fontWeight: 600 }} itemStyle={{ color: 'var(--muted)' }} cursor={{ stroke: 'var(--border)' }} />
              <Area type="monotone" dataKey="positive" stroke="#22C55E" fill="var(--ok-bg)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} name="Positive Replies" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>No daily data</div>
        )}
      </div>

      {/* Per-campaign response stats */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Campaign Response Stats</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Sentiment breakdown per campaign</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {statsLoading ? <SectionLoader height={120} /> : statsError ? (
            <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--err-text)' }}>{statsError}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {[
                    { label: 'Campaign',   col: 'campaign_name' },
                    { label: 'Sent',       col: 'total_sent' },
                    { label: 'Replies',    col: 'total_replies' },
                    { label: 'Reply Rate', col: 'reply_rate' },
                    { label: 'Positive',   col: 'positive_replies' },
                    { label: 'Negative',   col: 'negative_replies' },
                    { label: 'Neutral',    col: 'neutral_replies' },
                  ].map(({ label, col }) => (
                    <th key={col} onClick={() => handleSort(col)} style={{ fontSize: 11, color: sortCol === col ? 'var(--text)' : 'var(--muted)', fontWeight: 600, padding: '9px 18px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                      {label}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaign_name || `Campaign ${c.campaign_id}`}</td>
                    <td style={{ padding: '12px 18px', fontSize: 13 }}>{(c.total_sent || 0).toLocaleString()}</td>
                    <td style={{ padding: '12px 18px', fontSize: 13, fontWeight: 600 }}>{(c.total_replies || 0).toLocaleString()}</td>
                    <td style={{ padding: '12px 18px', fontSize: 13 }}>{c.reply_rate ? `${Math.round(c.reply_rate * 100) / 100}%` : '—'}</td>
                    <td style={{ padding: '12px 18px', fontSize: 13, color: 'var(--ok-text)', fontWeight: 600 }}>{c.positive_replies || 0}</td>
                    <td style={{ padding: '12px 18px', fontSize: 13, color: 'var(--err-text)', fontWeight: 600 }}>{c.negative_replies || 0}</td>
                    <td style={{ padding: '12px 18px', fontSize: 13, color: 'var(--muted)' }}>{c.neutral_replies || 0}</td>
                  </tr>
                ))}
                {responseStats.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No campaign data</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}

