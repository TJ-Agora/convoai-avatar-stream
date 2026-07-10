'use client';

import { useEffect, useRef, useState } from 'react';

const MODES = [
  {
    key: 'speak',
    label: 'Speak',
    hint: 'The avatar says exactly this, word for word.',
    placeholder: 'Type what the avatar should say…',
    submit: 'Speak',
  },
  {
    key: 'think',
    label: 'Think',
    hint: 'The avatar reads this and reacts in its own words. Your prompt stays hidden from the room.',
    placeholder: 'Give the avatar something to comment on…',
    submit: 'Send to avatar',
  },
];

/**
 * Host "+ Add Script" modal — Speak (verbatim /speak) or Think (LLM /think).
 * Modal on purpose: the old inline input reflowed the stage and shrank the
 * avatar mid-stream. Escape/overlay cancel; Cmd/Ctrl+Enter submits.
 */
export default function DirectAvatarModal({ open, onClose, onSpeak, onThink, mobile }) {
  const [mode, setMode] = useState('speak');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setText(''); setError(null); setMode('speak');
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = MODES.find((m) => m.key === mode);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError(null);
    try {
      await (mode === 'speak' ? onSpeak(t) : onThink(t));
      onClose?.();
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
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
          width: '100%', maxWidth: 520, background: 'var(--panel)',
          border: '1px solid var(--line-3)', borderRadius: 20, padding: '26px 26px 22px',
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 34px 70px -34px rgba(0,0,0,0.35)',
        }}
      >
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--faint)' }}>HOST CONTROLS</span>
        <h2 className="serif" style={{ margin: 0, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Direct the avatar</h2>

        {/* Speak / Think segmented control */}
        <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--stage)', borderRadius: 12, alignSelf: 'flex-start' }}>
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              style={{
                height: 36, padding: '0 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                background: mode === m.key ? 'var(--ink)' : 'transparent',
                color: mode === m.key ? '#fff' : 'var(--muted)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>{active.hint}</p>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          placeholder={active.placeholder}
          autoFocus
          rows={3}
          // 16px on mobile: prevents iOS Safari's focus auto-zoom.
          style={{
            width: '100%', padding: '12px 16px', border: '1px solid #DBDBD6', borderRadius: 12,
            fontSize: mobile ? 16 : 14, lineHeight: 1.5, background: 'var(--panel)', resize: 'vertical',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />

        {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--red)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginRight: 'auto' }}>{mobile ? '' : '⌘↩ to send'}</span>
          <button
            onClick={onClose}
            disabled={busy}
            style={{ height: 44, padding: '0 20px', borderRadius: 12, border: '1px solid var(--line-3)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            style={{
              height: 44, padding: '0 20px', borderRadius: 12, border: 'none',
              background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer', opacity: busy || !text.trim() ? 0.7 : 1,
            }}
          >
            {busy ? 'One moment…' : active.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
