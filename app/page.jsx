'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const WINDOWS = [
  { label: '10s', ms: 10000 },
  { label: '20s', ms: 20000 },
  { label: '30s', ms: 30000 },
];

export default function SetupPage() {
  const router = useRouter();
  const [channel, setChannel] = useState('Product AMA');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState('batched');
  const [windowMs, setWindowMs] = useState(20000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const create = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelTitle: channel.trim() || 'Live Stream',
          topic: topic.trim(),
          mode,
          collectionWindowMs: windowMs,
          ttsVendor: 'preset_minimax',
          avatarVendor: 'anam',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create channel');
      router.push(data.hostUrl);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const goJoin = () => {
    const code = joinCode.trim().split('/').pop();
    if (code) router.push(`/stream/${code}`);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 30 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="mono" style={{ fontSize: 12, letterSpacing: '0.16em', color: 'var(--faint)' }}>NEW CHANNEL</span>
          <h1 className="serif" style={{ margin: 0, fontSize: 44, lineHeight: 1.05, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Set up your stream</h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--muted)' }}>Configure how the avatar handles the room before you go live.</p>
        </div>

        {!showJoin ? (
          <>
            <Field label="CHANNEL NAME">
              <input value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle} />
            </Field>

            <Field label="TOPIC (OPTIONAL)">
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What should the avatar be knowledgeable about?" style={inputStyle} />
            </Field>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="mono" style={labelStyle}>RESPONSE MODE</span>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <ModeTile
                  active={mode === 'batched'} onClick={() => setMode('batched')}
                  title="Batched" desc="Collects everything for a set window, then answers the whole room at once."
                />
                <ModeTile
                  active={mode === 'sequential'} onClick={() => setMode('sequential')}
                  title="Sequential" desc="Queues questions and answers them one by one, in order."
                />
              </div>
            </div>

            {mode === 'batched' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span className="mono" style={labelStyle}>COLLECTION WINDOW</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  {WINDOWS.map((w) => (
                    <button key={w.ms} onClick={() => setWindowMs(w.ms)} style={{
                      flex: 1, height: 46, borderRadius: 12, cursor: 'pointer', fontSize: 15, fontWeight: 500,
                      border: windowMs === w.ms ? '2px solid var(--ink)' : '1px solid var(--line-3)',
                      background: windowMs === w.ms ? 'var(--ink)' : 'var(--panel)',
                      color: windowMs === w.ms ? '#fff' : 'var(--ink)',
                    }}>{w.label}</button>
                  ))}
                </div>
              </div>
            )}

            {error && <div style={errorStyle}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
              <button onClick={create} disabled={busy} style={{ height: 56, border: 'none', borderRadius: 14, background: 'var(--ink)', color: '#fff', cursor: busy ? 'wait' : 'pointer', fontSize: 16, fontWeight: 600, opacity: busy ? 0.7 : 1 }}>
                {busy ? 'Creating…' : 'Create & go live'}
              </button>
              <button onClick={() => setShowJoin(true)} style={linkBtnStyle}>Joining as a guest? Enter here →</button>
            </div>
          </>
        ) : (
          <>
            <Field label="STREAM LINK OR CODE">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') goJoin(); }} placeholder="paste the host's stream link" autoFocus style={inputStyle} />
            </Field>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
              <button onClick={goJoin} disabled={!joinCode.trim()} style={{ height: 56, border: 'none', borderRadius: 14, background: joinCode.trim() ? 'var(--ink)' : '#D6D6D1', color: joinCode.trim() ? '#fff' : 'var(--faint)', cursor: joinCode.trim() ? 'pointer' : 'not-allowed', fontSize: 16, fontWeight: 600 }}>Go to stream</button>
              <button onClick={() => setShowJoin(false)} style={linkBtnStyle}>← Back to setup</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle = { height: 52, padding: '0 18px', border: '1px solid var(--line-3)', borderRadius: 13, fontSize: 16, color: 'var(--ink)', background: 'var(--panel)', width: '100%' };
const labelStyle = { fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 500 };
const linkBtnStyle = { alignSelf: 'center', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: 'var(--muted)' };
const errorStyle = { padding: '10px 14px', background: 'color-mix(in oklab, var(--red) 10%, transparent)', border: '1px solid color-mix(in oklab, var(--red) 30%, transparent)', borderRadius: 10, fontSize: 13, color: 'var(--red)' };

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="mono" style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

function ModeTile({ active, onClick, title, desc }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 220, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8,
      border: active ? '2px solid var(--ink)' : '1px solid var(--line-3)', background: 'var(--panel)',
      borderRadius: 16, padding: active ? '17px 19px' : '18px 20px', cursor: 'pointer',
      boxShadow: active ? '0 0 0 4px rgba(11,11,11,0.05)' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: '50%', border: active ? '5px solid var(--ink)' : '2px solid #D2D2CD', background: 'var(--panel)' }} />
      </div>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{desc}</span>
    </button>
  );
}
