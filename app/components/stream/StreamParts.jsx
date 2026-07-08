'use client';

import { useEffect, useRef } from 'react';

// Agent state → label + accent, matching the design prototype.
export const STATE_MAP = {
  idle:      { label: 'IDLE',      color: 'var(--faint)' },
  listening: { label: 'LISTENING', color: 'var(--green)' },
  thinking:  { label: 'THINKING',  color: 'var(--blue)'  },
  speaking:  { label: 'SPEAKING',  color: 'var(--red)'   },
  silent:    { label: 'LISTENING', color: 'var(--green)' },
};

/** The agent status pill shown on the stage. */
export function StatePill({ state, size = 'md' }) {
  const st = STATE_MAP[state] || STATE_MAP.idle;
  const speaking = state === 'speaking';
  const pulsing = speaking || state === 'thinking';
  const pad = size === 'sm' ? '6px 12px' : '8px 15px';
  const fontSize = size === 'sm' ? 10 : 11;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 9, padding: pad,
      background: speaking ? 'var(--ink)' : 'var(--panel)',
      border: speaking ? 'none' : '1px solid var(--line-3)',
      borderRadius: 22,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: st.color,
        animation: pulsing ? 'livepulse 1.4s ease-in-out infinite' : 'none',
      }} />
      <span className="mono" style={{
        fontSize, fontWeight: 600, letterSpacing: '0.08em',
        color: speaking ? '#fff' : 'var(--ink)',
      }}>{st.label}</span>
    </div>
  );
}

/** Pulsing red "LIVE" indicator. */
export function LivePill() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', animation: 'livepulse 1.6s ease-in-out infinite' }} />
      <span className="mono" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--ink)' }}>LIVE</span>
    </div>
  );
}

/** Green presence dot + "N WATCHING". */
export function PresencePill({ count, compact = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />
      <span className="mono" style={{ fontSize: compact ? 11 : 12, fontWeight: 500, color: 'var(--muted)' }}>
        {count}{compact ? '' : ' WATCHING'}
      </span>
    </div>
  );
}

/** Animated caption waveform (three bars). */
export function CaptionBars() {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[0, 0.2, 0.4].map((d, i) => (
        <div key={i} style={{
          width: 3, height: 9, background: '#fff', borderRadius: 2,
          transformOrigin: 'center', animation: `wf 0.9s ${d}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
}

/** Loading spinner. */
export function Spinner({ size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: '3px solid #EAEAE6', borderTopColor: 'var(--ink)',
      animation: 'spin 0.9s linear infinite',
    }} />
  );
}

/**
 * Avatar stage surface. Plays the live agent video when present, otherwise
 * shows the diagonal-stripe "AVATAR VIDEO" placeholder from the design.
 * Renders the live-caption overlay when `caption` is set.
 */
export function AvatarStage({ videoTrack, caption, width, height, aspectRatio, radius = 18 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!videoTrack || !ref.current) return;
    videoTrack.play(ref.current);
    return () => { try { videoTrack.stop(); } catch (e) { /* ignore */ } };
  }, [videoTrack]);

  return (
    <div style={{ position: 'relative', width, height, maxWidth: '100%', ...(aspectRatio ? { aspectRatio } : {}) }}>
      {videoTrack ? (
        <div ref={ref} style={{ width: '100%', height: '100%', borderRadius: radius, overflow: 'hidden', background: '#000' }} />
      ) : (
        <div style={{
          width: '100%', height: '100%', borderRadius: radius,
          background: 'repeating-linear-gradient(45deg, #EAEAE5, #EAEAE5 9px, #F1F1ED 9px, #F1F1ED 18px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: '#B4B4AF' }}>AVATAR VIDEO</span>
        </div>
      )}

      {caption && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, padding: '32px 16px 14px',
          background: 'linear-gradient(to top, rgba(11,11,11,0.86), rgba(11,11,11,0))',
          borderRadius: `0 0 ${radius}px ${radius}px`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <CaptionBars />
            <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.7)' }}>LIVE CAPTION</span>
          </div>
          <span style={{ fontSize: 13, lineHeight: 1.4, color: '#fff' }}>{caption}</span>
        </div>
      )}
    </div>
  );
}
