'use client';

import { useState, useEffect } from 'react';
import StreamStage from './StreamStage';
import ChatRail from './ChatRail';
import { PresencePill, LivePill } from './StreamParts';

function useIsMobile(breakpoint = 900) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return mobile;
}

/**
 * The live stream view, shared by the host (/manage) and guest (/stream) pages.
 * Composes the avatar stage (left) and the chat rail (right), responsive.
 */
export default function StreamScreen({
  channel, isHost, myUid, myName, videoTrack, agentSpeakingState, liveCaption,
  isMuted, onToggleMute, onSend, onSpeakScript,
}) {
  const mobile = useIsMobile();

  // Local pill state: prefer the toolkit's live agent state, fall back to the
  // server's authoritative isSpeaking/agentState.
  const displayAgentState = agentSpeakingState || channel.agentState || (channel.isSpeaking ? 'speaking' : 'listening');

  const lost = channel.status === 'CLOSED';

  if (mobile) {
    return (
      <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)', position: 'relative' }}>
        {/* app bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
          <PresencePill count={channel.presence || 0} compact />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}>
            {channel.channelTitle || 'Live'}
          </span>
          <LivePill />
        </div>

        <StreamStage
          channel={channel} isHost={isHost} videoTrack={videoTrack} displayAgentState={displayAgentState} liveCaption={liveCaption}
          isMuted={isMuted} onToggleMute={onToggleMute} onSpeakScript={onSpeakScript} mobile
        />

        <ChatRail channel={channel} isHost={isHost} myUid={myUid} onSend={onSend} liveCaption={liveCaption} mobile />
      </div>
    );
  }

  return (
    <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
      <StreamStage
        channel={channel} isHost={isHost} videoTrack={videoTrack} displayAgentState={displayAgentState} liveCaption={liveCaption}
        isMuted={isMuted} onToggleMute={onToggleMute} onSpeakScript={onSpeakScript}
      />
      <ChatRail channel={channel} isHost={isHost} myUid={myUid} onSend={onSend} liveCaption={liveCaption} />

      {lost && (
        <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: 'var(--ink)', borderRadius: 999, zIndex: 20 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', animation: 'livepulse 1.1s ease-in-out infinite' }} />
          <span className="mono" style={{ fontSize: 12, letterSpacing: '0.04em', color: '#fff' }}>Stream ended</span>
        </div>
      )}
    </div>
  );
}
