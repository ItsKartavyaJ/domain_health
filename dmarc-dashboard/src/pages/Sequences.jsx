import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import DateFilter from '../components/DateFilter';
import { getCampaignList, getSequenceAnalytics } from '../api/smartlead';

const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

function fetchSequences(campaignId, s, e, setSequences, setError, setSeqLoading) {
  if (!campaignId) return;
  setSeqLoading(true);
  getSequenceAnalytics(campaignId, s, e)
    .then((data) => setSequences(Array.isArray(data) ? data : []))
    .catch((err) => setError(err.message))
    .finally(() => setSeqLoading(false));
}

export default function Sequences() {
  const [startDate, setStartDate] = useState(THIRTY_DAYS_AGO);
  const [endDate, setEndDate] = useState(TODAY);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seqLoading, setSeqLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getCampaignList()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setCampaigns(list);
        if (list.length > 0) {
          setSelectedCampaign(list[0].id);
          fetchSequences(list[0].id, THIRTY_DAYS_AGO, TODAY, setSequences, setError, setSeqLoading);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function onCampaignChange(id) {
    setSelectedCampaign(id);
    fetchSequences(id, startDate, endDate, setSequences, setError, setSeqLoading);
  }

  function onDateChange(s, e) {
    setStartDate(s);
    setEndDate(e);
    if (selectedCampaign) fetchSequences(selectedCampaign, s, e, setSequences, setError, setSeqLoading);
  }

  const chartData = sequences.map((seq, i) => ({
    name: `Step ${seq.seq_number || i + 1}`,
    sent: seq.sent_count || 0,
    opened: seq.open_count || 0,
    replied: seq.reply_count || 0,
    bounced: seq.bounce_count || 0,
    positive: seq.positive_reply_count || 0,
  }));

  const bestStep = chartData.reduce((best, step) => {
    const rate = step.sent > 0 ? step.replied / step.sent : 0;
    const bestRate = best.sent > 0 ? best.replied / best.sent : 0;
    return rate > bestRate ? step : best;
  }, chartData[0] || { name: '—', sent: 0, replied: 0 });

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
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Sequence Performance</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {loading ? 'Loading...' : `${campaigns.length} campaigns available`}
          </p>
        </div>
        <DateFilter startDate={startDate} endDate={endDate} onChange={onDateChange} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', height: 200, alignItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading campaigns...</div>
      ) : (
        <>
          {/* Campaign selector */}
          <div style={{ marginBottom: 20 }}>
            <select
              value={selectedCampaign || ''}
              onChange={(e) => onCampaignChange(e.target.value)}
              style={{
                fontSize: 13, padding: '8px 14px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', minWidth: 320,
              }}
            >
              <option value="">Select a campaign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name || `Campaign ${c.id}`}</option>
              ))}
            </select>
          </div>

          {seqLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', height: 200, alignItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading sequence data...</div>
          ) : sequences.length === 0 ? (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '48px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {selectedCampaign ? 'No sequence data for this campaign' : 'Select a campaign to view sequence analytics'}
            </div>
          ) : (
            <>
              {/* Best performing step */}
              {bestStep && bestStep.sent > 0 && (
                <div style={{ background: 'var(--ok-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E' }} />
                  <div style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: 'var(--ok-text)' }}>{bestStep.name}</span>
                    <span style={{ color: 'var(--text)' }}> has the highest reply rate: </span>
                    <span style={{ fontWeight: 700, color: 'var(--ok-text)' }}>{Math.round((bestStep.replied / bestStep.sent) * 100)}%</span>
                    <span style={{ color: 'var(--muted)' }}> ({bestStep.replied} replies from {bestStep.sent} sent)</span>
                  </div>
                </div>
              )}

              {/* Stacked bar chart */}
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Performance by Sequence Step</div>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="sent" fill="#3B82F6" name="Sent" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="opened" fill="#8B5CF6" name="Opened" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="replied" fill="#F59E0B" name="Replied" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="positive" fill="#22C55E" name="Positive" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="bounced" fill="#EF4444" name="Bounced" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Step details table */}
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Step Details</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Conversion at each email step</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        {['Step', 'Sent', 'Opened', 'Open Rate', 'Replied', 'Reply Rate', 'Positive', 'Bounced'].map((h) => (
                          <th key={h} style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '9px 14px', textAlign: 'left', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map((step, i) => {
                        const openRate = step.sent > 0 ? Math.round((step.opened / step.sent) * 100) : 0;
                        const replyRate = step.sent > 0 ? Math.round((step.replied / step.sent) * 100) : 0;
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600 }}>{step.name}</td>
                            <td style={{ padding: '12px 14px', fontSize: 13 }}>{step.sent.toLocaleString()}</td>
                            <td style={{ padding: '12px 14px', fontSize: 13 }}>{step.opened.toLocaleString()}</td>
                            <td style={{ padding: '12px 14px', fontSize: 13 }}>{openRate}%</td>
                            <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: 'var(--ok-text)' }}>{step.replied.toLocaleString()}</td>
                            <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: replyRate > 5 ? 'var(--ok-text)' : replyRate > 2 ? 'var(--warn-text)' : 'var(--muted)' }}>{replyRate}%</td>
                            <td style={{ padding: '12px 14px', fontSize: 13, color: '#22C55E', fontWeight: 600 }}>{step.positive}</td>
                            <td style={{ padding: '12px 14px', fontSize: 13, color: 'var(--err-text)' }}>{step.bounced}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
