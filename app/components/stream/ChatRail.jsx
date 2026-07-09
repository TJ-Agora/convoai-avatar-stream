'use client';

import { useState, useRef, useEffect } from 'react';
import { PresencePill, LivePill } from './StreamParts';

function QueueList({ queue, myUid }) {
  return (
    <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--faint)' }}>IN QUEUE</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--faint-2)' }}>{queue.length} waiting</span>
      </div>
      {queue.map((q, i) => {
        const isNow = i === 0;
        const isYou = String(q.uid) === String(myUid);
        return (
          <div key={q.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: isYou ? '9px 11px' : '4px 2px', borderRadius: isYou ? 10 : 0,
            background: isYou ? '#EEF2FD' : 'transparent', border: isYou ? '1px solid #DCE4FA' : 'none',
          }}>
            <span className="mono" style={{ fontSize: 11, fontWeight: 600, width: 32, flexShrink: 0, color: isNow ? 'var(--green)' : (isYou ? 'var(--blue)' : 'var(--faint-2)') }}>
              {isNow ? 'NOW' : String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: isYou ? 500 : 400, color: isYou ? 'var(--ink)' : (isNow ? 'var(--muted)' : '#A6A6A1'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {q.user} — {q.text}
            </span>
            {isYou && <span className="mono" style={{ fontSize: 10, color: 'var(--blue)' }}>~{i * 40}s</span>}
          </div>
        );
      })}
    </div>
  );
}

function MessageBubble({ m, myUid }) {
  const self = String(m.uid) === String(myUid);
  const agent = m.kind === 'agent';
  const dark = self || agent;
  const agentLabel = m.scripted ? 'AGENT · SCRIPTED' : (m.interrupted ? 'AVATAR · INTERRUPTED' : 'AVATAR');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: self ? 'flex-end' : 'flex-start' }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--faint-2)' }}>
        {agent ? agentLabel : (self ? 'YOU' : m.user)}
      </span>
      <div style={{
        background: dark ? 'var(--ink)' : 'var(--stage)',
        color: dark ? '#fff' : 'var(--ink)',
        borderRadius: self ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
        padding: '10px 14px', maxWidth: '88%', fontSize: 14, lineHeight: 1.4,
      }}>{m.text}</div>
    </div>
  );
}

/**
 * Shown while the avatar is generating/speaking a think-answer. Streams the
 * words as they're spoken when the live transcript is flowing in this tab;
 * falls back to animated "typing" dots until the first words arrive.
 */
function PendingAnswerBubble({ liveText }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--faint-2)' }}>AVATAR</span>
      <div style={{
        background: 'var(--ink)', color: '#fff', borderRadius: '4px 14px 14px 14px',
        padding: '10px 14px', maxWidth: '88%', fontSize: 14, lineHeight: 1.4,
      }}>
        {liveText ? (
          <>{liveText}<span style={{ opacity: 0.6 }}>▍</span></>
        ) : (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', height: 14 }}>
            {[0, 0.2, 0.4].map((d, i) => (
              <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: `think 1.2s ${d}s infinite` }} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function Composer({ isHost, onSend, mobile }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText('');
    try { await onSend(t); }
    catch (e) { /* surfaced upstream */ }
    finally { setBusy(false); }
  };
  return (
    <div style={{ borderTop: '1px solid var(--line-2)', padding: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        placeholder={isHost ? 'Ask the avatar a question…' : 'Ask a question…'}
        // 16px on mobile: iOS Safari auto-zooms (and stays zoomed) when a
        // focused input's font-size is below 16px.
        style={{ flex: 1, height: 42, padding: '0 14px', border: 'none', borderRadius: 11, background: 'var(--stage)', fontSize: mobile ? 16 : 14, color: 'var(--ink)' }}
      />
      <button onClick={send} disabled={busy} style={{ width: 42, height: 42, border: 'none', borderRadius: 11, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, cursor: 'pointer' }}>→</button>
    </div>
  );
}

export default function ChatRail({ channel, isHost, myUid, onSend, mobile, liveCaption }) {
  const messages = channel.messages || [];
  const isSequential = channel.mode === 'sequential';
  const showPending = !!channel.answerPending;
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, showPending, liveCaption]);

  return (
    <div style={{
      width: mobile ? '100%' : 340, flex: mobile ? 1 : undefined, minHeight: 0,
      borderLeft: mobile ? 'none' : '1px solid var(--line)', background: 'var(--panel)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* header */}
      {!mobile && (
        <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--line-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <PresencePill count={channel.presence || 0} />
          <LivePill />
        </div>
      )}

      {/* sequential queue */}
      {isSequential && (channel.queue?.length > 0) && <QueueList queue={channel.queue} myUid={myUid} />}

      {/* messages */}
      <div ref={scrollRef} className="scroll-y" style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        {messages.length === 0 && !showPending ? (
          <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--faint-2)' }}>NO MESSAGES YET</span>
            <span style={{ fontSize: 14, color: 'var(--muted-2)' }}>Say hello to start the conversation.</span>
          </div>
        ) : (
          <>
            {/* Render the pending bubble at its anchor (right under the
                question(s) being answered) so chats arriving mid-answer stack
                below it — matching where the final answer will insert. */}
            {(() => {
              const anchorId = channel.answerAnchorId;
              const anchorFound = showPending && anchorId != null && messages.some((m) => m.id === anchorId);
              return (
                <>
                  {messages.map((m) => (
                    <div key={m.id} style={{ display: 'contents' }}>
                      <MessageBubble m={m} myUid={myUid} />
                      {anchorFound && m.id === anchorId && <PendingAnswerBubble liveText={liveCaption} />}
                    </div>
                  ))}
                  {showPending && !anchorFound && <PendingAnswerBubble liveText={liveCaption} />}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* composer */}
      <Composer isHost={isHost} onSend={onSend} mobile={mobile} />
    </div>
  );
}
