import { useState } from 'react';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', fontFamily: 'system-ui, sans-serif' }}>
      <form
        onSubmit={handleSubmit}
        style={{ width: 360, background: 'var(--card-bg)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 20 }}
      >
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>DMARC Monitor Login</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Authorized user access only.</div>

        <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          style={{ width: '100%', marginBottom: 12, fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface)' }}
        />

        <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          style={{ width: '100%', marginBottom: 12, fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface)' }}
        />

        {error ? <div style={{ color: '#A32D2D', fontSize: 12, marginBottom: 10 }}>{error}</div> : null}

        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', border: 'none', borderRadius: 8, padding: '9px 12px', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
