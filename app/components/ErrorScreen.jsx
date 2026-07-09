'use client';

/**
 * Full-page terminal state (invalid link, stream not found, stream ended)
 * with a way out — never strand the user on a dead end.
 */
export default function ErrorScreen({ eyebrow, title, body, ctaHref = '/', ctaLabel = 'Go to home' }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
      <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'center', alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 12, letterSpacing: '0.16em', color: 'var(--faint)' }}>{eyebrow}</span>
        <h1 className="serif" style={{ margin: 0, fontSize: 36, lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--muted)' }}>{body}</p>
        <a
          href={ctaHref}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 48, padding: '0 28px', marginTop: 8, borderRadius: 13,
            background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, textDecoration: 'none',
          }}
        >
          {ctaLabel}
        </a>
      </div>
    </div>
  );
}
