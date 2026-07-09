'use client';

import { useState, useEffect, useRef } from 'react';
import { StatePill, AvatarStage } from './StreamParts';
import JoinQr from './JoinQr';

function fmt(s) {
  const sec = Math.max(0, Math.floor(s));
  const m = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/** Top HUD: mode + progress bar + timer. Runs a local 1s ticker for batched. */
function HUD({ mode, batchPhase, batchCount, batchDeadline, collectionWindowMs, queueLength, compact, channelName }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Server timers are deadline-driven (no in-process setTimeout on serverless):
  // when our local countdown crosses the deadline, poke /state once — the
  // server's tick closes the batch window within ~1s instead of waiting for
  // the next 10s poll.
  const firedForRef = useRef(0);
  useEffect(() => {
    if (mode !== 'batched' || !batchDeadline || !channelName) return;
    if (now < batchDeadline || firedForRef.current === batchDeadline) return;
    firedForRef.current = batchDeadline;
    fetch(`/api/channels/${channelName}/state`, { cache: 'no-store' }).catch(() => {});
  }, [now, mode, batchDeadline, channelName]);

  let top, sub, progress;
  if (mode === 'batched') {
    if (batchPhase === 'answering' || !batchDeadline) {
      top = 'BATCHED · ANSWERING';
      sub = 'responding to the room…';
      progress = '100%';
    } else {
      const remaining = (batchDeadline - now) / 1000;
      top = 'BATCHED · COLLECTING';
      sub = `${fmt(remaining)} left · ${batchCount} in batch`;
      const win = (collectionWindowMs || 30000) / 1000;
      progress = `${Math.min(100, Math.max(0, Math.round((1 - remaining / win) * 100)))}%`;
    }
  } else {
    top = 'SEQUENTIAL';
    sub = `${queueLength} in queue`;
    progress = queueLength ? '40%' : '0%';
  }

  if (compact) {
    return (
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--muted-2)' }}>
        {top} · {sub}
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--muted-2)' }}>{top}</span>
      <div style={{ width: 150, height: 4, borderRadius: 3, background: '#E4E4DF', overflow: 'hidden' }}>
        <div style={{ width: progress, height: '100%', background: 'var(--ink)', transition: 'width 0.9s linear' }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{sub}</span>
    </div>
  );
}

/** Host controls under the stage: Add Script → Speak, Mute, join-QR (desktop). */
function HostControls({ isMuted, onToggleMute, onSpeakScript, qr }) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptText, setScriptText] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const t = scriptText.trim();
    if (!t || busy) return;
    setBusy(true);
    try { await onSpeakScript(t); setScriptText(''); setScriptOpen(false); }
    catch (e) { /* surfaced upstream */ }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {scriptOpen && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="Type what the avatar should say…"
            autoFocus
            style={{ flex: 1, height: 44, padding: '0 16px', border: '1px solid #DBDBD6', borderRadius: 12, fontSize: 14, background: 'var(--panel)' }}
          />
          <button onClick={send} disabled={busy || !scriptText.trim()} style={{ height: 44, padding: '0 20px', border: 'none', borderRadius: 12, background: 'var(--ink)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>Speak</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <button onClick={() => setScriptOpen((o) => !o)} style={{ height: 44, padding: '0 20px', border: 'none', borderRadius: 12, background: 'var(--ink)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>+ Add Script</button>
        <button onClick={onToggleMute} style={{ height: 44, padding: '0 18px', borderRadius: 12, border: '1px solid #DBDBD6', background: isMuted ? 'var(--stage)' : 'var(--panel)', color: 'var(--ink)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>{isMuted ? 'Unmute agent' : 'Mute agent'}</button>
        {qr && <div style={{ marginLeft: 'auto' }}>{qr}</div>}
      </div>
    </div>
  );
}

export default function StreamStage({
  channel, isHost, videoTrack, displayAgentState, isMuted, onToggleMute, onSpeakScript, mobile, liveCaption,
}) {
  // Desktop: 75% of the stage's available height (design portrait ratio 272:360).
  // Mobile: fixed, modest footprint so the chat keeps most of the screen.
  const avatarW = mobile ? 200 : 'auto';
  const avatarH = mobile ? 260 : '75%';
  const avatarAspect = mobile ? undefined : '272 / 360';
  const radius = mobile ? 16 : 18;
  // Prefer the real words streaming from the toolkit's transcript events;
  // fall back to the server's caption (host scripts / "Answering…" status).
  const caption = liveCaption || channel.caption;

  return (
    <div style={{
      flex: 1, minWidth: 0, position: 'relative', background: 'var(--stage)',
      display: 'flex', flexDirection: 'column', padding: mobile ? '14px 16px' : '26px 28px', gap: mobile ? 12 : 0,
    }}>
      {/* top: state pill + HUD */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: mobile ? 'center' : 'flex-start' }}>
        <StatePill state={displayAgentState} size={mobile ? 'sm' : 'md'} />
        <HUD
          mode={channel.mode}
          batchPhase={channel.batchPhase}
          batchCount={channel.batchCount}
          batchDeadline={channel.batchDeadline}
          collectionWindowMs={channel.collectionWindowMs}
          queueLength={channel.queue?.length || 0}
          compact={mobile}
          channelName={channel.channelName}
        />
      </div>

      {/* center: avatar */}
      <div style={{ flex: mobile ? undefined : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, padding: mobile ? 0 : '18px 0' }}>
        <AvatarStage videoTrack={videoTrack} caption={caption} width={avatarW} height={avatarH} aspectRatio={avatarAspect} radius={radius} />
      </div>

      {/* host controls (desktop hosts get the join-QR in-row, where the mode
          chip used to be — in-flow so the script input never overlaps it) */}
      {isHost && (
        <HostControls
          isMuted={isMuted}
          onToggleMute={onToggleMute}
          onSpeakScript={onSpeakScript}
          qr={!mobile ? <JoinQr channelId={channel.channelName} /> : null}
        />
      )}

      {/* Guests have no controls row — float the QR bottom-right of the stage.
          Desktop only: scanning a QR on the phone you're holding is pointless. */}
      {!isHost && !mobile && (
        <div style={{ position: 'absolute', right: 28, bottom: 26 }}>
          <JoinQr channelId={channel.channelName} />
        </div>
      )}
    </div>
  );
}
