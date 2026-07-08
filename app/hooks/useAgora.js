'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// Agora transcript text omits spaces after punctuation ("Paris!It's…"). Insert
// one when followed by a letter — never a digit (protects 3.14 / 1,000 / 3:30).
const fixPunctuationSpacing = (s) => (s || '').replace(/([.,!?;:])(?=[A-Za-z])/g, '$1 ');

/**
 * Hook to join an Agora RTC channel and subscribe to the agent's audio + video.
 * Also joins RTM and uses Agora's Conversational AI toolkit to receive
 * standardized agent-state events (silent/listening/thinking/speaking), which
 * drive the local AgentStatePill display. The authoritative speech-done signal
 * that releases the server lock is posted from useChannel (it listens for the
 * raw RTM state.speaking=false event); see the note on AGENT_STATE_CHANGED below.
 */
export default function useAgora(channelName, { startMuted = false, enableAvatar = false, userRtcToken = null, userRtmToken = null, userUid = null, channelId = null, clientRole = 'audience' } = {}) {
  const [remoteAudioTrack, setRemoteAudioTrack] = useState(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(startMuted);
  const [agentSpeakingState, setAgentSpeakingState] = useState(null);
  const [liveCaption, setLiveCaption] = useState('');       // real words as spoken (in-progress turn)
  const postedTurnsRef = useRef(new Set());                  // turn_ids this client already POSTed
  const rtcClientRef = useRef(null);
  const rtmClientRef = useRef(null);
  const agoraRTCRef = useRef(null);
  const agoraRTMRef = useRef(null);
  const convoAIRef = useRef(null);
  const trackRef = useRef(null);
  const prevAgentStateRef = useRef(null);
  const joiningRef = useRef(false);
  const agentGoneTimerRef = useRef(null);  // auto-leave after agent unpublishes for N seconds
  const leaveRef = useRef(null);           // populated below so timers can call leave()

  // If the agent's audio publish goes away and stays away for this long,
  // the audience client auto-leaves the channel to stop accruing cost.
  const AGENT_GONE_LEAVE_MS = 30_000;

  const join = useCallback(async () => {
    if (!channelName) return;
    if (!userUid || !userRtcToken || !userRtmToken) {
      console.log('[useAgora] bail: credentials not ready', { channelName, userUid, hasRtcToken: !!userRtcToken, hasRtmToken: !!userRtmToken });
      return;
    }
    // Prevent concurrent join calls (React strict mode double-mount)
    if (joiningRef.current || rtcClientRef.current) {
      console.log('[useAgora] bail: already joining or joined');
      return;
    }
    joiningRef.current = true;

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    if (!appId) {
      console.error('NEXT_PUBLIC_AGORA_APP_ID not set');
      return;
    }

    // --- RTC setup ---
    if (!agoraRTCRef.current) {
      const AgoraRTCModule = await import('agora-rtc-sdk-ng');
      agoraRTCRef.current = AgoraRTCModule.default;
    }

    const AgoraRTC = agoraRTCRef.current;
    AgoraRTC.setLogLevel(3);
    // Required for word-by-word transcript rendering: the toolkit syncs the
    // live caption to audio timestamp (PTS) metadata, which RTC only delivers
    // when this is set BEFORE the client is created. (Agora docs: transcripts)
    try {
      AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true);
    } catch (err) {
      console.warn('[RTC] ENABLE_AUDIO_PTS_METADATA not supported:', err);
    }

    // Live-broadcast mode scales to many guests per channel: the agent is the
    // only media publisher. Guests join as invisible 'audience'. The HOST joins
    // as 'host' (broadcaster) without publishing anything — a visible role is
    // required for the ConvoAI agent to detect the join and fire its native
    // greeting_message (audience members are invisible to other participants).
    const client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
    rtcClientRef.current = client;
    try {
      await client.setClientRole(clientRole === 'host' ? 'host' : 'audience');
    } catch (err) {
      console.error(`[RTC] setClientRole(${clientRole}) failed:`, err);
    }

    client.on('user-published', async (user, mediaType) => {
      if (mediaType === 'audio') {
        // Agent (or any audio publisher) came back — cancel any pending auto-leave.
        if (agentGoneTimerRef.current) {
          clearTimeout(agentGoneTimerRef.current);
          agentGoneTimerRef.current = null;
        }
        try {
          const remoteTrack = await client.subscribe(user, mediaType);
          trackRef.current = remoteTrack;
          setRemoteAudioTrack(remoteTrack);
          remoteTrack.setVolume(isMuted ? 0 : 100);
          remoteTrack.play();
        } catch (err) {
          console.error('Error subscribing to remote audio:', err);
        }
      }
      if (mediaType === 'video') {
        try {
          const remoteTrack = await client.subscribe(user, mediaType);
          setRemoteVideoTrack(remoteTrack);
          console.log('[RTC] Subscribed to avatar video, uid:', user.uid);
        } catch (err) {
          console.error('Error subscribing to remote video:', err);
        }
      }
    });

    client.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'audio') {
        trackRef.current = null;
        setRemoteAudioTrack((track) => {
          if (track) {
            track.stop();
            track.close();
          }
          return null;
        });
        // The only audio publisher in the channel is the agent. If we don't
        // see a fresh user-published within the grace window, assume the
        // agent is gone for good and leave the channel so we stop paying
        // for the audience subscription.
        if (agentGoneTimerRef.current) clearTimeout(agentGoneTimerRef.current);
        agentGoneTimerRef.current = setTimeout(() => {
          console.log(`[RTC] Agent absent for ${AGENT_GONE_LEAVE_MS / 1000}s — leaving channel`);
          leaveRef.current?.();
        }, AGENT_GONE_LEAVE_MS);
      }
      if (mediaType === 'video') {
        setRemoteVideoTrack((track) => {
          if (track) {
            track.stop();
            track.close();
          }
          return null;
        });
      }
    });

    const uid = userUid || (enableAvatar ? 101 : Math.floor(10000 + Math.random() * 90000));
    const token = userRtcToken || null;
    console.log(`[RTC] Joining channel ${channelName} with uid ${uid}, enableAvatar=${enableAvatar}, hasToken=${!!token}`);
    await client.join(appId, channelName, token, uid);

    // --- RTM setup ---
    try {
      if (!agoraRTMRef.current) {
        const AgoraRTMModule = await import('agora-rtm-sdk');
        agoraRTMRef.current = AgoraRTMModule.default;
      }

      const { RTM } = agoraRTMRef.current;
      const rtmUserId = userUid ? String(userUid) : `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      console.log(`[RTM] Logging in as ${rtmUserId}, hasToken=${!!userRtmToken}`);
      const rtmClient = new RTM(appId, rtmUserId, {
        presenceTimeout: 30,
        logUpload: false,
        logLevel: 'none',
        cloudProxy: false,
        useStringUserId: true,
      });
      rtmClientRef.current = rtmClient;

      await rtmClient.login({ token: userRtmToken || '' });

      await rtmClient.subscribe(channelName, {
        withMessage: true,
        withPresence: true,
        withMetadata: false,
        withLock: false,
      });

      // --- Conversational AI toolkit ---
      // The toolkit reads RTM presence + messages and emits a standardized
      // EAgentState (idle/listening/thinking/speaking/silent). We treat any
      // transition out of "speaking" as the authoritative speech-done signal.
      const [{ ConversationalAIAPI }, { EConversationalAIAPIEvents, EAgentState, ETurnStatus, ETranscriptHelperMode }] = await Promise.all([
        import('../lib/conversational-ai-api'),
        import('../lib/conversational-ai-api/type'),
      ]);

      ConversationalAIAPI.init({
        rtcEngine: client,
        rtmEngine: rtmClient,
        // Word-by-word transcript rendering (drives the live caption); pairs
        // with ENABLE_AUDIO_PTS_METADATA set above for audio-synced reveal.
        renderMode: ETranscriptHelperMode.WORD,
        enableLog: false,
      });
      const convoAI = ConversationalAIAPI.getInstance();
      // Clear any listeners left over from a previous session — init() reuses
      // the singleton, so .on() handlers from prior sessions would otherwise stack.
      convoAI.removeAllEventListeners();
      convoAIRef.current = convoAI;

      convoAI.on(EConversationalAIAPIEvents.AGENT_STATE_CHANGED, (agentUserId, event) => {
        const newState = event.state;
        const prevState = prevAgentStateRef.current;
        console.log(`[ConvoAI] Agent state: ${prevState ?? '∅'} → ${newState} (turn ${event.turnID})`);

        setAgentSpeakingState(newState);
        prevAgentStateRef.current = newState;

        // NOTE: We no longer POST agent-state from this handler. The toolkit's
        // presence-based AGENT_STATE_CHANGED doesn't reliably advance for
        // /speak-only flows (turnID stays at 1 and state stays 'idle' between
        // presence re-fires from audience join/leave, which caused stuck
        // speech locks). The real state changes are on RTM as `state.speaking`
        // messages — useChannel listens for those and drives the server lock.
        // We keep this handler alive purely to update the local AgentStatePill
        // UI display when the toolkit does happen to fire something useful.
      });

      convoAI.on(EConversationalAIAPIEvents.AGENT_INTERRUPTED, (agentUserId, event) => {
        console.log(`[ConvoAI] Agent interrupted at turn ${event.turnID}`);
      });

      convoAI.on(EConversationalAIAPIEvents.AGENT_ERROR, (agentUserId, error) => {
        console.error(`[ConvoAI] Agent error in ${error.type}: ${error.message} (${error.code})`);
      });

      // Real agent transcripts (the LLM's answers are generated inside Agora's
      // pipeline — this event is the only place the actual text surfaces).
      //  - IN_PROGRESS turn → live caption, word by word, rendered locally.
      //  - END/INTERRUPTED turn → POST once to /transcript for the shared chat
      //    feed. Every client posts; the server dedupes by turn_id.
      convoAI.on(EConversationalAIAPIEvents.TRANSCRIPT_UPDATED, (history) => {
        try {
          // Classify agent turns by MESSAGE TYPE, never by uid. The toolkit's
          // uid heuristic is inverted for our server-injected-text flow: agent
          // answers ride the agent's audio stream (stream_id != 0) so the
          // toolkit labels them uid '0' (self), while the /think question echo
          // (a user.transcription with stream_id 0) gets the agent publisher's
          // uid. The only reliable discriminator: user items carry
          // metadata.object === 'user.transcription'; everything else in the
          // history is an agent turn (word-queue metadata has no `object`,
          // text/chunk-mode agent items carry 'assistant.transcription').
          const agentItems = (history || []).filter(
            (it) => it.metadata?.object !== 'user.transcription'
          );
          if (agentItems.length === 0) return;

          // Live caption: the PTS-revealed text of the in-progress turn.
          const inProgress = agentItems.filter((it) => it.status === ETurnStatus.IN_PROGRESS);
          setLiveCaption(inProgress.length ? fixPunctuationSpacing(inProgress[inProgress.length - 1].text) : '');

          // Feed: judge finality + take text from the RAW message metadata,
          // which is independent of the PTS word-reveal (item.text/status only
          // advance as audio timestamps catch up — the raw turn status and full
          // text are always on the metadata object).
          for (const it of agentItems) {
            const raw = it.metadata || {};
            const status = raw.status ?? raw.turn_status ?? it.status;
            if (status === ETurnStatus.IN_PROGRESS) continue;
            const text = (typeof raw.text === 'string' && raw.text.trim()) ? raw.text : it.text;
            const key = String(it.turn_id);
            if (postedTurnsRef.current.has(key)) continue;
            postedTurnsRef.current.add(key);
            if (!text || !text.trim() || !channelId) continue;
            fetch(`/api/channels/${channelId}/transcript`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                turnId: it.turn_id,
                text,
                interrupted: status === ETurnStatus.INTERRUPTED,
              }),
            }).catch((err) => console.error('[useAgora] transcript post error:', err));
          }
        } catch (err) {
          console.error('[useAgora] transcript handler error:', err);
        }
      });

      convoAI.subscribeMessage(channelName);
    } catch (err) {
      console.error('RTM/ConvoAI setup error:', err);
    }

    setIsJoined(true);
  }, [channelName, isMuted, enableAvatar, userRtcToken, userRtmToken, userUid, channelId, clientRole]);

  const leave = useCallback(async () => {
    joiningRef.current = false;
    trackRef.current = null;
    if (agentGoneTimerRef.current) {
      clearTimeout(agentGoneTimerRef.current);
      agentGoneTimerRef.current = null;
    }
    setRemoteAudioTrack((track) => {
      if (track) {
        track.stop();
        track.close();
      }
      return null;
    });

    if (convoAIRef.current) {
      try {
        convoAIRef.current.unsubscribe();
      } catch (err) {
        console.error('ConvoAI unsubscribe error:', err);
      }
      convoAIRef.current = null;
    }

    if (rtmClientRef.current) {
      try {
        await rtmClientRef.current.logout();
      } catch (err) {
        console.error('RTM logout error:', err);
      }
      try {
        rtmClientRef.current.removeAllListeners();
      } catch (err) { /* ignore */ }
      rtmClientRef.current = null;
    }

    if (rtcClientRef.current) {
      try {
        await rtcClientRef.current.leave();
      } catch (err) {
        console.error('Error leaving RTC:', err);
      }
      rtcClientRef.current = null;
    }

    prevAgentStateRef.current = null;
    setAgentSpeakingState(null);
    setLiveCaption('');
    postedTurnsRef.current = new Set();
    setIsJoined(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (trackRef.current) {
        trackRef.current.setVolume(next ? 0 : 100);
      }
      return next;
    });
  }, []);

  // Keep leaveRef pointed at the current leave() so the agent-gone timer
  // inside the join closure can call out to leave without depending on the
  // latest closure binding.
  useEffect(() => { leaveRef.current = leave; }, [leave]);

  // Cleanup on unmount — deferred to survive React Strict Mode's unmount/remount cycle
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setTimeout(() => {
        if (mountedRef.current) return; // remounted — don't clean up
        joiningRef.current = false;
        trackRef.current = null;
        if (convoAIRef.current) {
          try { convoAIRef.current.unsubscribe(); } catch (e) { /* ignore */ }
          convoAIRef.current = null;
        }
        if (rtmClientRef.current) {
          rtmClientRef.current.logout().catch(() => {});
          try { rtmClientRef.current.removeAllListeners(); } catch (e) { /* ignore */ }
          rtmClientRef.current = null;
        }
        if (rtcClientRef.current) {
          rtcClientRef.current.leave().catch(() => {});
          rtcClientRef.current = null;
        }
      }, 100);
    };
  }, []);

  return { remoteAudioTrack, remoteVideoTrack, isJoined, isMuted, agentSpeakingState, liveCaption, join, leave, toggleMute };
}
