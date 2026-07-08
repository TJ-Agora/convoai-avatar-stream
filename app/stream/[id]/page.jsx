'use client';

import { useState, useEffect } from 'react';
import useChannel from '../../hooks/useChannel';
import useAgora from '../../hooks/useAgora';
import StreamScreen from '../../components/stream/StreamScreen';
import { Spinner } from '../../components/stream/StreamParts';

const emailValid = (e) => !e || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export default function GuestStreamPage({ params }) {
  const { id } = params;
  const [name, setName] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [creds, setCreds] = useState(null);      // useAgora (RTC + RTM) — UID_A
  const [rtmCreds, setRtmCreds] = useState(null); // useChannel (RTM only) — UID_B
  const [credsError, setCredsError] = useState(null);

  const channel = useChannel(id, null, rtmCreds ? { rtmToken: rtmCreds.rtmToken, rtmUid: rtmCreds.uid } : null);

  // Restore identity from this tab's localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(`stream:${id}:name`);
    if (saved) setName(saved);
  }, [id]);

  // Mint TWO independent credential sets (two UIDs) — one per RTM identity.
  useEffect(() => {
    let alive = true;
    const fetchCreds = () =>
      fetch(`/api/channels/${id}/credentials?role=guest`).then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Channel not found' : `Credentials failed (${res.status})`);
        return res.json();
      });
    Promise.all([fetchCreds(), fetchCreds()])
      .then(([a, b]) => { if (alive) { setCreds(a); setRtmCreds(b); } })
      .catch((err) => { if (alive) setCredsError(err.message); });
    return () => { alive = false; };
  }, [id]);

  const { remoteVideoTrack, isJoined, agentSpeakingState, liveCaption, join, leave } = useAgora(
    channel.channelName,
    {
      enableAvatar: channel.enableAvatar,
      userRtcToken: creds?.rtcToken,
      userRtmToken: creds?.rtmToken,
      userUid: creds?.uid,
      channelId: id,
    }
  );

  // Lazy join: only enter the RTC channel once the stream is live (avoids
  // paying audience-minutes for an empty room before the host goes live).
  const isLive = channel.status === 'LIVE';
  const isOver = channel.status === 'CLOSED';
  const canJoin = !!channel.channelName && !!creds && isLive && !!name;

  useEffect(() => {
    if (canJoin && !isJoined) join();
    if (!canJoin && isJoined) leave();
  }, [canJoin, isJoined, join, leave]);

  // Presence heartbeat while joined.
  useEffect(() => {
    if (!name || !rtmCreds?.uid || !isLive) return;
    channel.sendPresence(rtmCreds.uid, name);
    const t = setInterval(() => channel.sendPresence(rtmCreds.uid, name), 15000);
    return () => clearInterval(t);
  }, [name, rtmCreds?.uid, isLive, channel]);

  const submitJoin = (e) => {
    e.preventDefault();
    const n = nameInput.trim();
    if (!n || !emailValid(emailInput.trim())) return;
    setName(n);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(`stream:${id}:name`, n); } catch (_) { /* ignore */ }
    }
  };

  const onSend = (text) => channel.sendMessage(text, { uid: rtmCreds?.uid, user: name });

  // --- Render gates ---

  if (!name && !isOver) {
    return <JoinGate channel={channel} name={nameInput} email={emailInput} onName={setNameInput} onEmail={setEmailInput} onSubmit={submitJoin} error={credsError} />;
  }

  const frame = { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)' };

  if (isOver) {
    return (
      <div style={{ ...frame, alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', padding: 24 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--faint-2)' }}>STREAM ENDED</span>
        <span className="serif" style={{ fontSize: 28, color: 'var(--ink)' }}>Thanks for watching</span>
        <span style={{ fontSize: 14, color: 'var(--muted)' }}>You can safely close this tab.</span>
      </div>
    );
  }

  if (!isLive || !isJoined) {
    return (
      <div style={{ ...frame, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <Spinner />
        <span className="mono" style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--muted)' }}>
          {isLive ? 'CONNECTING' : 'WAITING FOR HOST'} TO {(channel.channelTitle || id).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div style={frame}>
      <StreamScreen
        channel={channel}
        isHost={false}
        myUid={rtmCreds?.uid}
        myName={name}
        videoTrack={remoteVideoTrack}
        agentSpeakingState={agentSpeakingState}
        liveCaption={liveCaption}
        onSend={onSend}
      />
    </div>
  );
}

function JoinGate({ channel, name, email, onName, onEmail, onSubmit, error }) {
  const ok = name.trim().length > 0 && emailValid(email.trim());
  return (
    <div style={{ minHeight: '100vh', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="mono" style={{ fontSize: 12, letterSpacing: '0.16em', color: 'var(--faint)' }}>JOIN CHANNEL</span>
          <h1 className="serif" style={{ margin: 0, fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
            You're joining {channel.channelTitle || 'the stream'}
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--muted)' }}>Tell us who you are so the host knows who's asking.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 500 }}>YOUR NAME</span>
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Ada Lovelace" autoFocus style={gateInput} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 500 }}>EMAIL</span>
          <input value={email} onChange={(e) => onEmail(e.target.value)} placeholder="ada@example.com" type="email" style={gateInput} />
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>Only visible to the host. We won't post anything.</span>
        </div>
        {error && <div style={{ fontSize: 13, color: 'var(--red)' }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
          <button type="submit" disabled={!ok} style={{ height: 56, border: 'none', borderRadius: 14, cursor: ok ? 'pointer' : 'not-allowed', fontSize: 16, fontWeight: 600, background: ok ? 'var(--ink)' : '#D6D6D1', color: ok ? '#fff' : 'var(--faint)' }}>Join channel</button>
        </div>
      </form>
    </div>
  );
}

const gateInput = { height: 52, padding: '0 18px', border: '1px solid var(--line-3)', borderRadius: 13, fontSize: 16, color: 'var(--ink)', background: 'var(--panel)' };
