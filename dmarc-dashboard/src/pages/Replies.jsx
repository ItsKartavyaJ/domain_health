import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import DateFilter from '../components/DateFilter';
import { getReplyCategories, getDailyPositiveReplies, getResponseStats } from '../api/smartlead';

const COLORS = ['#22C55E', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6B7280'];
const SENTIMENT_COLORS = { positive: '#22C55E', neutral: '#3B82F6', negative: '#EF4444' };

const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

function loadReplyData(s, e) {
  return Promise.all([
    getReplyCategories(s, e),
    getDailyPositiveReplies(s, e),
    getResponseStats(s, e),
  ]);
}

export default function Replies() {
  const [startDate, setStartDate] = useState(THIRTY_DAYS_AGO);
  const [endDate, setEndDate] = useState(TODAY);
  const [categories, setCategories] = useState([]);
  const [dailyReplies, setDailyReplies] = useState([]);
  const [responseStats, setResponseStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function applyResults([cats, daily, resp]) {
    setCategories(Array.isArray(cats) ? cats : []);
    setDailyReplies(Array.isArray(daily) ? daily : []);
    setResponseStats(Array.isArray(resp) ? resp : []);
  }

  useEffect(() => {
    loadReplyData(THIRTY_DAYS_AGO, TODAY)
      .then(applyResults)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function onDateChange(s, e) {
    setStartDate(s);
    setEndDate(e);
    setLoading(true);
    setError(null);
    loadReplyData(s, e)
      .then(applyResults)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  const totalReplies = categories.reduce((sum, c) => sum + (c.total_response || 0), 0);

  if (error) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
        <div style={{ background: 'var(--err-bg)', color: 'var(--err-text)', borderRadius: 10, padding: '14px 20px', fontSize: 13 }}>{error}</div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Reply Intelligence</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading...' : `${totalReplies} total replies`}
          </p>
        </div>
        <DateFilter startDate={startDate} endDate={endDate} onChange={onDateChange} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', height: 200, alignItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading reply data...</div>
      ) : (
        <>
          {/* Category breakdown + pie chart */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
            {/* Pie chart */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Reply Categories</div>
              {categories.length > 0 ? (
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
                      contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }}
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
                {categories.length === 0 && (
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
            {dailyReplies.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={dailyReplies.map((d) => ({ date: d.date || '', positive: d.positive_replies || 0 }))} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, padding: '8px 12px' }} cursor={{ stroke: 'var(--border)' }} />
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
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    {['Campaign', 'Sent', 'Replies', 'Reply Rate', 'Positive', 'Negative', 'Neutral'].map((h) => (
                      <th key={h} style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '9px 18px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(responseStats) ? responseStats : []).slice(0, 25).map((c, i) => (
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
                  {(!Array.isArray(responseStats) || responseStats.length === 0) && (
                    <tr><td colSpan={7} style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No campaign data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
