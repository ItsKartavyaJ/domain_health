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
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 380, padding: 32 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <path d="M2 10 L7 2 L12 10" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.5 7 L9.5 7" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>DMARC Monitor</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>pintel.ai</div>
          </div>
        </div>

        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.04)' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>Sign in</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>Use your <strong style={{ color: 'var(--text)' }}>@pintel.ai</strong> Google account to continue.</div>
          </div>

          {error && (
            <div style={{ fontSize: 13, color: 'var(--err-text)', background: 'var(--err-bg)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              border: '1px solid var(--border)', borderRadius: 9, padding: '10px 16px',
              background: loading ? 'var(--surface)' : 'var(--card-bg)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 500, color: 'var(--text)',
              transition: 'background 0.15s',
            }}
          >
            {!loading && (
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.2 33.2 29.7 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l6-6C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.2-4z"/>
              </svg>
            )}
            {loading ? 'Signing in…' : 'Continue with Google'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--muted)' }}>
          Access restricted to @pintel.ai accounts only.
        </div>
      </div>
    </div>
  );
}
