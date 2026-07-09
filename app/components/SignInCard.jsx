'use client';

/**
 * Sign-in prompt for host-only surfaces (production SSO mode). Guests never
 * see this — guest viewing is public by design.
 */
export default function SignInCard({ signInUrl, authError, note }) {
  return (
    <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="mono" style={{ fontSize: 12, letterSpacing: '0.16em', color: 'var(--faint)' }}>HOSTS ONLY</span>
        <h1 className="serif" style={{ margin: 0, fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
          Sign in to host
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--muted)' }}>
          Creating and managing streams requires an Agora account — the same sign-in as console.agora.io.
        </p>
      </div>
      {authError && (
        <div style={{ padding: '10px 14px', background: 'color-mix(in oklab, var(--red) 10%, transparent)', border: '1px solid color-mix(in oklab, var(--red) 30%, transparent)', borderRadius: 10, fontSize: 13, color: 'var(--red)' }}>
          Sign-in failed ({authError}). Try again.
        </div>
      )}
      <a
        href={signInUrl}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', height: 56,
          borderRadius: 14, background: 'var(--ink)', color: '#fff',
          fontSize: 16, fontWeight: 600, textDecoration: 'none',
        }}
      >
        Sign in with Agora
      </a>
      {note && <span style={{ fontSize: 13, color: 'var(--faint)', textAlign: 'center' }}>{note}</span>}
    </div>
  );
}
