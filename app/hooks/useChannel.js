'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const INITIAL_STATE = {
  status: 'IDLE',                // 'IDLE' | 'LIVE' | 'CLOSED'
  mode: 'batched',              // 'batched' | 'sequential'
  collectionWindowMs: 30000,
  channelTitle: '',
  agentId: null,
  channelName: null,
  enableAvatar: false,
  isSpeaking: false,
  answerPending: false,         // a /think answer is being generated/spoken
  answerAnchorId: null,         // feed message id the pending answer belongs after
  agentState: 'idle',           // 'idle' | 'listening' | 'thinking' | 'speaking'
  caption: '',
  lastSpokenText: null,
  messages: [],
  queue: [],
  batchPhase: 'collecting',
  batchCount: 0,
  batchDeadline: null,
  presence: 0,
};

/**
 * Track a single channel's state and expose action callbacks.
 *
 * @param {string} channelId - the channel's public ID (also the RTM channel name)
 * @param {string|null} hostToken - if present, host-only actions attach it
 * @param {{rtmToken: string, rtmUid: number|string}} [creds]
 *   RTM credentials minted by /api/channels/[id]/credentials. State broadcasts
 *   only arrive once the RTM client subscribes, which needs these.
 */
export default function useChannel(channelId, hostToken = null, creds = null) {
  const [channelState, setChannelState] = useState(INITIAL_STATE);
  const [error, setError] = useState(null);
  const rtmClientRef = useRef(null);
  const agoraRTMRef = useRef(null);

  // Initial state fetch + periodic poll. RTM broadcasts cover state changes
  // when the server is healthy, but if the channel is force-deleted or the
  // server vanishes (HMR, deploy, crash), the broadcast never fires. The poll
  // detects that: a 404 transitions us to CLOSED so the page can auto-leave the
  // RTC channel and stop accruing audience cost.
  useEffect(() => {
    if (!channelId) return;
    let mounted = true;

    const pollState = async () => {
      try {
        const res = await fetch(`/api/channels/${channelId}/state`, { cache: 'no-store' });
        if (!mounted) return;
        if (res.status === 404) {
          setChannelState((prev) => prev.status === 'CLOSED' ? prev : { ...prev, status: 'CLOSED' });
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data && data.type === 'state') setChannelState(data);
        }
      } catch (err) {
        // Network error — leave state as-is and try again on the next tick.
      }
    };

    pollState();
    const interval = setInterval(pollState, 10_000);
    return () => { mounted = false; clearInterval(interval); };
  }, [channelId]);

  // RTM subscription — needs creds (rtmToken + a UID to log in as).
  useEffect(() => {
    if (!channelId || !creds?.rtmToken || creds?.rtmUid == null) return;

    let mounted = true;

    async function connectRTM() {
      try {
        const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
        if (!appId) {
          console.error('NEXT_PUBLIC_AGORA_APP_ID not set');
          return;
        }

        if (!agoraRTMRef.current) {
          const AgoraRTMModule = await import('agora-rtm-sdk');
          agoraRTMRef.current = AgoraRTMModule.default;
        }

        const { RTM } = agoraRTMRef.current;
        const rtmUserId = String(creds.rtmUid);
        const rtmClient = new RTM(appId, rtmUserId, {
          presenceTimeout: 30,
          logUpload: false,
          logLevel: 'none',
          cloudProxy: false,
          useStringUserId: true,
        });
        rtmClientRef.current = rtmClient;

        await rtmClient.login({ token: creds.rtmToken });

        await rtmClient.subscribe(channelId, {
          withMessage: true,
          withPresence: false,
          withMetadata: false,
          withLock: false,
        });

        // Re-fetch state to catch any broadcasts missed during RTM connection.
        try {
          const freshRes = await fetch(`/api/channels/${channelId}/state`, { cache: 'no-store' });
          const freshData = await freshRes.json();
          if (mounted && freshData && freshData.type === 'state') setChannelState(freshData);
        } catch (err) {
          console.error('[useChannel] Post-RTM state fetch error:', err);
        }

        rtmClient.addEventListener('message', (eventArgs) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(eventArgs.message);

            // Case 1: server state broadcasts (full channel snapshot).
            if (data && data.type === 'state') {
              setChannelState(data);
              setError(null);
              return;
            }

            // Case 2: Agora agent state.speaking events. The toolkit's
            // presence-based AGENT_STATE_CHANGED doesn't advance for /speak or
            // /think calls (turn_id stays at 1), so we drive the server's speech
            // lock off these authoritative agent-side events.
            //   payload.value === false → speech ended → release the lock
            if (data && data.event_type === 'state.speaking' && data.payload) {
              const speakingNow = data.payload.value;
              if (speakingNow === false && channelId) {
                fetch(`/api/channels/${channelId}/agent-state`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ state: 'idle' }),
                }).catch((err) => console.error('[useChannel] agent-state notify error:', err));
              }
            }
          } catch (err) {
            // Ignore non-JSON or non-state messages.
          }
        });

        console.log(`[useChannel] RTM connected to channel "${channelId}"`);
      } catch (err) {
        console.error('[useChannel] RTM connection error:', err);
        setError('RTM connection failed');
      }
    }

    connectRTM();

    return () => {
      mounted = false;
      if (rtmClientRef.current) {
        rtmClientRef.current.logout().catch(() => {});
        try { rtmClientRef.current.removeAllListeners(); } catch (e) { /* ignore */ }
        rtmClientRef.current = null;
      }
    };
  }, [channelId, creds?.rtmToken, creds?.rtmUid]);

  // --- Actions ---

  const hostHeaders = useCallback(() => {
    const h = { 'Content-Type': 'application/json' };
    if (hostToken) h['X-Channel-Host-Token'] = hostToken;
    return h;
  }, [hostToken]);

  // Send a chat message / question. Identity (uid/user) comes from the caller.
  const sendMessage = useCallback(async (text, { uid, user } = {}) => {
    const res = await fetch(`/api/channels/${channelId}/message`, {
      method: 'POST',
      headers: hostHeaders(),
      body: JSON.stringify({ text, uid, user }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }, [channelId, hostHeaders]);

  // Host manual script — the agent speaks it verbatim.
  const speakScript = useCallback(async (text) => {
    const res = await fetch(`/api/channels/${channelId}/speak`, {
      method: 'POST', headers: hostHeaders(),
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }, [channelId, hostHeaders]);

  // hostUid: the host tab's RTC UID — the agent watches it for join/leave
  // (native greeting + idle detection).
  const start = useCallback(async (hostUid) => {
    const res = await fetch(`/api/channels/${channelId}/start`, {
      method: 'POST', headers: hostHeaders(),
      body: JSON.stringify({ hostUid }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }, [channelId, hostHeaders]);

  const stop = useCallback(async () => {
    const res = await fetch(`/api/channels/${channelId}/stop`, {
      method: 'POST', headers: hostHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }, [channelId, hostHeaders]);

  // Uses hostHeaders so the host tab's heartbeat carries the host token — the
  // server counts the host in presence but skips the per-guest welcome for it.
  const sendPresence = useCallback(async (uid, name) => {
    try {
      await fetch(`/api/channels/${channelId}/presence`, {
        method: 'POST',
        headers: hostHeaders(),
        body: JSON.stringify({ uid, name }),
      });
    } catch (err) {
      // Best-effort; ignore.
    }
  }, [channelId, hostHeaders]);

  return {
    ...channelState,
    error,
    channelId,
    sendMessage,
    speakScript,
    start,
    stop,
    sendPresence,
  };
}
