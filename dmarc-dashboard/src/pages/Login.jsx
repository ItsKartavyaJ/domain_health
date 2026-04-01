import { useState } from 'react';
import { signInWithGoogle } from '../api/auth';

export default function Login({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGoogleSignIn() {
    setLoading(true);
    setError('');
    try {
      const user = await signInWithGoogle();
      onLogin(user);
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 360, background: 'var(--card-bg)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>DMARC Monitor</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Sign in with your @pintel.ai account.</div>

        {error ? <div style={{ color: '#A32D2D', fontSize: 12, marginBottom: 12 }}>{error}</div> : null}

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: '0.5px solid var(--border)', borderRadius: 8, padding: '9px 12px', background: 'var(--card-bg)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.2 33.2 29.7 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l6-6C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.2-4z"/>
          </svg>
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  );
}
