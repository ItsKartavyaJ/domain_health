import { useEffect, useState } from 'react';
import { getCurrentUser, login, logout } from './api/auth';
import Overview from './pages/Overview';
import Login from './pages/Login';

const navItems = ['Overview', 'Domains', 'Reports', 'Alerts', 'Settings'];

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then((current) => setUser(current))
      .finally(() => setCheckingAuth(false));
  }, []);

  async function handleLogin(username, password) {
    const result = await login(username, password);
    setUser(result.user);
  }

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        :root {
          --bg: #f5f5f4;
          --card-bg: #ffffff;
          --surface: #f1efe8;
          --border: rgba(0,0,0,0.12);
          --muted: #888780;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #111213;
            --card-bg: #1a1b1e;
            --surface: #222327;
            --border: rgba(255,255,255,0.1);
            --muted: #888780;
          }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; color: inherit; }
        body { color: #1a1a1a; }
        @media (prefers-color-scheme: dark) { body { color: #d8d9da; } }
        tr:hover td { background: var(--surface) !important; }
      `}</style>

      {checkingAuth ? (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Checking session...</div>
      ) : !user ? (
        <Login onLogin={handleLogin} />
      ) : (
      <>
      <div style={{ background: 'var(--card-bg)', borderBottom: '0.5px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#378ADD' }}/>
          DMARC Monitor
        </div>
        <div style={{ display: 'flex', gap: 2, marginLeft: 24 }}>
          {navItems.map((item, i) => (
            <div key={item} style={{
              fontSize: 13, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
              background: i === 0 ? 'var(--surface)' : 'transparent',
              fontWeight: i === 0 ? 500 : 400,
              color: i === 0 ? 'inherit' : 'var(--muted)',
            }}>{item}</div>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: '#0C447C' }}>
            {String(user || 'U').slice(0, 2).toUpperCase()}
          </div>
          <button
            onClick={handleLogout}
            style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--card-bg)', cursor: 'pointer' }}
          >
            Logout
          </button>
        </div>
      </div>

      <Overview />
      </>
      )}
    </div>
  );
}