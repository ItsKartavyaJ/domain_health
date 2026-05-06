import { useEffect, useState } from 'react';
import { onAuthChange, logout } from './api/auth';
import Overview from './pages/Overview';
import Replies from './pages/Replies';
import Mailboxes from './pages/Mailboxes';
import Campaigns from './pages/Campaigns';
import Domains from './pages/Domains';
import Login from './pages/Login';
import BlacklistStatus from './pages/BlacklistStatus';
import DnsStatus from './pages/DnsStatus';
import WarmupDetail from './pages/WarmupDetail';
import WarmupStats from './pages/WarmupStats';
import Issues from './pages/Issues';
import SenderHealth from './pages/SenderHealth';

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'replies', label: 'Replies' },
  { key: 'mailboxes', label: 'Mailboxes' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'domains', label: 'Domains' },
  { key: 'sender-health', label: 'Sender Health' },
  { key: 'warmup-stats', label: 'Warmup' },
];

const VALID_TABS = new Set([...tabs.map((t) => t.key), 'blacklist', 'dns-status', 'warmup', 'issues', 'sender-health', 'warmup-stats']);

function getHashTab() {
  const hash = window.location.hash.slice(1);
  return VALID_TABS.has(hash) ? hash : 'overview';
}

const tabComponents = {
  overview: Overview,
  replies: Replies,
  mailboxes: Mailboxes,
  campaigns: Campaigns,
  domains: Domains,
  blacklist: BlacklistStatus,
  'dns-status': DnsStatus,
  warmup: WarmupDetail,
  'warmup-stats': WarmupStats,
  issues: Issues,
  'sender-health': SenderHealth,
};

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState(getHashTab);

  useEffect(() => {
    const unsubscribe = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setCheckingAuth(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    function onHashChange() {
      setActiveTab(getHashTab());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  function handleTabClick(key) {
    window.location.hash = key;
    setActiveTab(key);
  }

  if (checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2.5px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Checking session...</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <Login onLogin={setUser} />;

  const initials = String(user.email || 'U').slice(0, 2).toUpperCase();
  const ActivePage = tabComponents[activeTab] || Overview;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Top nav */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--card-bg)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        display: 'flex', alignItems: 'center', gap: 8, height: 52,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 16 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 10 L7 2 L12 10" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.5 7 L9.5 7" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>DMARC Monitor</span>
        </div>

        {/* Nav tabs */}
        <nav style={{ display: 'flex', gap: 2 }}>
          {tabs.map((tab) => (
            <div
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              style={{
                fontSize: 13, padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
                background: activeTab === tab.key ? 'var(--surface)' : 'transparent',
                fontWeight: activeTab === tab.key ? 500 : 400,
                color: activeTab === tab.key ? 'var(--text)' : 'var(--muted)',
                transition: 'background 0.15s',
              }}
            >{tab.label}</div>
          ))}
        </nav>

        {/* Right side */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E' }} />
            {user.email}
          </div>
          {user.photoURL ? (
            <img src={user.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid var(--border)' }} />
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--info-text)' }}>
              {initials}
            </div>
          )}
          <button
            onClick={handleLogout}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', transition: 'all 0.15s' }}
          >
            Sign out
          </button>
        </div>
      </header>

      <ActivePage />
    </div>
  );
}
