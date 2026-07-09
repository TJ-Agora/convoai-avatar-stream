'use client';

import { useEffect } from 'react';

/**
 * Design-language replacement for window.confirm(). Overlay click and Escape
 * cancel; the confirm action is styled as destructive when `danger` is set.
 */
export default function ConfirmModal({ open, eyebrow, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, busy = false, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(11,11,11,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 420, background: 'var(--panel)',
          border: '1px solid var(--line-3)', borderRadius: 20, padding: '26px 26px 22px',
          display: 'flex', flexDirection: 'column', gap: 12,
          boxShadow: '0 34px 70px -34px rgba(0,0,0,0.35)',
        }}
      >
        {eyebrow && (
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--faint)' }}>{eyebrow}</span>
        )}
        <h2 className="serif" style={{ margin: 0, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{body}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{ height: 44, padding: '0 20px', borderRadius: 12, border: '1px solid var(--line-3)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              height: 44, padding: '0 20px', borderRadius: 12, border: 'none',
              background: danger ? 'var(--red)' : 'var(--ink)', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'One moment…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
