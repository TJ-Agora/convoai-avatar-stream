// Channel Manager — per-channel orchestrator for the AI Avatar Stream.
//
// Holds one or more live channels in a Map keyed by ID. Channels are created
// via createChannel(opts) which returns an ID + a separate (unguessable) host
// token. Per-channel interfaces are obtained via getChannel(id), and host
// privilege is verified via getChannelByHostToken(token).
//
// All per-channel helpers (broadcastState, markSpeechDone, speakNow,
// drainQueue, openBatchWindow, closeBatchWindow, etc.) live INSIDE getChannel
// so they close over the instance `a`. This is non-negotiable — those helpers
// schedule timers and one-shot callbacks; if they were re-bound to a different
// instance, two concurrent channels would leak into each other.
//
// The agent answers audience questions in one of two response modes:
//   - sequential: questions queue up; the agent answers one at a time.
//   - batched:    questions collect for a window; at close the agent answers
//                 the whole room at once, then a new window opens.
// Both modes are serialized by the speech lock (isSpeaking + markSpeechDone +
// notifyAgentState), which is the load-bearing mechanism carried over from the
// original auction build.

import * as agora from './agoraService.js';

// --- Module-level state ---

if (!globalThis.__channels) {
  globalThis.__channels = new Map();
}
if (!globalThis.__channelHostTokens) {
  globalThis.__channelHostTokens = new Map(); // hostToken → channelId
}
const CHANNELS = globalThis.__channels;
const HOST_TOKENS = globalThis.__channelHostTokens;

const IDLE_STATES = new Set(['listening', 'silent', 'idle']);

// A participant is considered "present" if we've heard a heartbeat within this
// window. The stream page beats every 15s.
const PRESENCE_TTL_MS = 30 * 1000;

// Cleanup tuning
const CLOSED_EVICTION_AGE_MS = 30 * 60 * 1000;     // CLOSED channels linger 30 min
const IDLE_EVICTION_AGE_MS   = 2 * 60 * 60 * 1000; // never-started IDLE channels linger 2 hours
const SWEEP_INTERVAL_MS      = 5 * 60 * 1000;      // sweep every 5 min

// --- ID generation ---

// Lowercase alphanumeric, omitting visually ambiguous chars (0,1,l,o).
const ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

function randomId(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

// --- Prompt builders ---

function buildHostSystemPrompt(title, topic) {
  return [
    `You are a friendly live host running a 1-to-many stream${title ? ` called "${title}"` : ''}.`,
    topic ? `The topic of this stream is: ${topic}.` : '',
    'Answer audience questions warmly and concisely — usually 1 to 3 sentences.',
    'Your words are spoken aloud by a live avatar — always reply in natural spoken prose. Never use numbered lists, bullet points, headings, or any written formatting.',
    'When several questions arrive together, respond like a live host reading the chat: weave the answers into one flowing reply, group related questions, and address people by name when it feels natural. Make sure every question gets answered, then invite more.',
    'Keep the energy up and conversational. Never mention that you are an AI model unless you are directly asked.',
  ].filter(Boolean).join(' ');
}

function buildBatchPrompt(questions) {
  // No numbering — numbered input invites a numbered answer, which sounds
  // robotic when spoken. Present the batch as a plain chat log instead.
  const lines = questions
    .map((q) => `${q.user || 'Someone'}: ${q.text}`)
    .join('\n');
  return `Here are the questions from the room since your last answer:\n${lines}\n\nRespond to the room in one natural, flowing spoken reply — like a live host reading the chat. Cover every question, group related ones together, and mention people by name where it helps. Do not enumerate or number your answers.`;
}

function buildGreeting(title) {
  return `Hey everyone, welcome${title ? ` to ${title}` : ''}! I'm your host. Drop your questions in the chat and I'll answer them live.`;
}

// Guests who join within this window are welcomed together in one utterance.
const WELCOME_BATCH_MS = 4000;

function buildWelcome(names) {
  if (names.length === 1) return `Welcome ${names[0]} to the stream!`;
  if (names.length === 2) return `Welcome ${names[0]} and ${names[1]} to the stream!`;
  return `Welcome ${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]} to the stream!`;
}

// Loose text normalization for matching a TTS transcript back to the text we
// sent via /speak (punctuation/casing may differ slightly in the transcript).
function normalizeText(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

// Agora's transcript/history text is segmented at punctuation for TTS and
// rejoined without spaces ("Paris!It's…", "history,architecture"). Re-insert a
// space after sentence punctuation when followed by a letter — never a digit,
// so decimals (3.14), thousands (1,000), and times (3:30) stay intact.
function fixPunctuationSpacing(s) {
  return (s || '').replace(/([.,!?;:])(?=[A-Za-z])/g, '$1 ');
}

// --- Instance factory ---

function makeChannelInstance(id) {
  return {
    id,
    hostToken: null,
    channelName: id,               // ID doubles as the RTC + RTM channel name
    agentId: null,
    status: 'IDLE',                // 'IDLE' | 'LIVE' | 'CLOSED'

    // config (from setup)
    mode: 'batched',               // 'batched' | 'sequential'
    collectionWindowMs: 30000,     // batched only
    channelTitle: '',
    topic: '',
    config: {},                    // ttsVendor, avatarVendor, ttsSpeed
    enableAvatar: false,

    // shared chat feed (broadcast to everyone)
    messages: [],                  // {id, uid, user, text, kind:'chat'|'agent'}
    nextMsgId: 1,

    // sequential
    questionQueue: [],             // {id, uid, user, text}

    // batched
    batchQuestions: [],            // buffer for the CURRENT collecting window
    batchPhase: 'collecting',      // 'collecting' | 'answering'
    batchDeadline: null,           // epoch ms when the window closes (client HUD reads this)
    batchTimer: null,
    batchPendingAnswer: false,     // window closed while agent was still speaking

    // speech lock (reused from the auction build)
    isSpeaking: false,
    answerPending: false,          // a /think answer is being generated/spoken (drives the chat's pending bubble)
    answerAnchorId: null,          // feed message id the in-flight answer belongs after (keeps Q→A grouped even if new chats arrive mid-answer)
    agentState: 'idle',            // 'idle' | 'listening' | 'thinking' | 'speaking'
    onSpeechDoneCallback: null,
    lastStateNotificationAt: 0,
    lastSpokenText: null,
    caption: '',

    // presence
    participants: new Map(),       // uid → {name, lastSeen}

    // per-guest welcomes (custom /speak — the native greeting covers the host)
    welcomeQueue: [],              // names waiting to be announced
    welcomedKeys: new Set(),       // uids + normalized names already welcomed
    welcomeTimer: null,            // batching-window timer

    // agent transcripts (server pulls /history; clients also post via /transcript)
    transcriptTurns: new Set(),    // turn_ids already appended to the feed
    recentSpeakTexts: [],          // normalized texts of recent /speak calls (echo guard)
    historySyncInFlight: false,    // guard against overlapping history fetches

    // create-time stash consumed by start()
    pendingOptions: null,

    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

// --- Multi-channel lifecycle ---

/**
 * Create a new channel. Allocates a unique ID + host token, stores the setup
 * options for later use by start(), and returns the identifiers needed to
 * build the guest and host URLs.
 *
 * @param {object} opts
 * @param {string=} opts.channelTitle
 * @param {string=} opts.topic
 * @param {('batched'|'sequential')=} opts.mode
 * @param {number=} opts.collectionWindowMs
 * @param {string=} opts.ttsVendor
 * @param {string=} opts.avatarVendor
 * @param {number=} opts.ttsSpeed
 * @returns {{id: string, hostToken: string, guestUrl: string, hostUrl: string}}
 */
export function createChannel(opts = {}) {
  let id;
  do { id = randomId(8); } while (CHANNELS.has(id));
  const hostToken = randomId(32);

  const a = makeChannelInstance(id);
  a.hostToken = hostToken;
  a.channelTitle = (opts.channelTitle || '').toString().slice(0, 120);
  a.topic = (opts.topic || '').toString().slice(0, 500);
  a.mode = opts.mode === 'sequential' ? 'sequential' : 'batched';
  const win = Number(opts.collectionWindowMs);
  if (Number.isFinite(win) && win >= 5000 && win <= 300000) a.collectionWindowMs = win;
  a.enableAvatar = (opts.avatarVendor && opts.avatarVendor !== 'none') || false;
  a.pendingOptions = {
    ttsVendor: opts.ttsVendor,
    avatarVendor: opts.avatarVendor,
    ttsSpeed: opts.ttsSpeed,
  };

  CHANNELS.set(id, a);
  HOST_TOKENS.set(hostToken, id);

  console.log(`[ChannelManager:${id}] Created (hostToken=${hostToken.slice(0, 8)}…, mode=${a.mode}, avatar=${a.enableAvatar})`);

  return {
    id,
    hostToken,
    guestUrl: `/stream/${id}`,
    hostUrl: `/manage/${hostToken}`,
  };
}

/**
 * Look up a channel by its host token. Returns the channel interface (same
 * shape as getChannel(id)) or null.
 */
export function getChannelByHostToken(token) {
  if (!token) return null;
  const id = HOST_TOKENS.get(token);
  if (!id) return null;
  return getChannel(id);
}

/**
 * Tear down a channel's timers, leave its Agora agent (if still running), and
 * remove it from the Maps.
 */
export async function deleteChannel(id) {
  const a = CHANNELS.get(id);
  if (!a) return;
  if (a.batchTimer) {
    clearTimeout(a.batchTimer);
    a.batchTimer = null;
  }
  if (a.welcomeTimer) {
    clearTimeout(a.welcomeTimer);
    a.welcomeTimer = null;
  }
  if (a.agentId) {
    try {
      await agora.leaveAgent(a.agentId);
    } catch (err) {
      console.error(`[ChannelManager:${id}] leaveAgent during delete failed:`, err.message);
    }
    a.agentId = null;
  }
  if (a.hostToken) HOST_TOKENS.delete(a.hostToken);
  CHANNELS.delete(id);
  console.log(`[ChannelManager:${id}] Deleted`);
}

/**
 * Lightweight list of all channels for a dashboard.
 */
export function listChannels() {
  return Array.from(CHANNELS.values()).map((a) => ({
    id: a.id,
    status: a.status,
    mode: a.mode,
    channelTitle: a.channelTitle,
    presence: countPresent(a),
    messageCount: a.messages.length,
    createdAt: a.createdAt,
    lastActivityAt: a.lastActivityAt,
    hostUrl: a.hostToken ? `/manage/${a.hostToken}` : null,
    guestUrl: `/stream/${a.id}`,
  }));
}

// Count participants heard from within the presence TTL.
function countPresent(a) {
  const now = Date.now();
  let n = 0;
  for (const [, p] of a.participants) {
    if (now - p.lastSeen <= PRESENCE_TTL_MS) n++;
  }
  return n;
}

// --- Per-channel interface factory ---

export function getChannel(id) {
  const a = CHANNELS.get(id);
  if (!a) return null;

  // Backfill fields that may be missing on instances created by an older
  // version of the code (dev HMR). Centralized migration point.
  if (!a.participants) a.participants = new Map();
  if (!a.messages) a.messages = [];
  if (!a.questionQueue) a.questionQueue = [];
  if (!a.batchQuestions) a.batchQuestions = [];
  if (!a.welcomeQueue) a.welcomeQueue = [];
  if (!a.welcomedKeys) a.welcomedKeys = new Set();
  if (!a.transcriptTurns) a.transcriptTurns = new Set();
  if (!a.recentSpeakTexts) a.recentSpeakTexts = [];
  if (a.nextMsgId == null) a.nextMsgId = 1;

  const log = (...args) => console.log(`[ChannelManager:${a.id}]`, ...args);

  // ---------- broadcast ----------

  function broadcastState() {
    const payload = getState();
    agora.publishChannelMessage(a.channelName, payload).catch((err) => {
      console.error(`[ChannelManager:${a.id}] RTM broadcast error:`, err);
    });
  }

  // ---------- state snapshot ----------

  function getState() {
    a.lastActivityAt = Date.now();

    // Prune stale participants so the count is fresh.
    const now = Date.now();
    for (const [uid, p] of a.participants) {
      if (now - p.lastSeen > PRESENCE_TTL_MS) a.participants.delete(uid);
    }

    return {
      type: 'state',                 // disambiguates snapshots from agent state.speaking events
      status: a.status,
      mode: a.mode,
      collectionWindowMs: a.collectionWindowMs,
      channelTitle: a.channelTitle,
      agentId: a.agentId,
      channelName: a.channelName,
      enableAvatar: a.enableAvatar,
      isSpeaking: a.isSpeaking,
      answerPending: a.answerPending,
      answerAnchorId: a.answerAnchorId,
      agentState: a.agentState,
      caption: a.caption,
      lastSpokenText: a.lastSpokenText,
      messages: a.messages,
      queue: a.questionQueue.map((q, i) => ({ ...q, position: i })),
      batchPhase: a.batchPhase,
      batchCount: a.batchQuestions.length,
      batchDeadline: a.batchDeadline,
      presence: a.participants.size,
    };
  }

  // ---------- speech tracking ----------

  function resetSpeechTracking() {
    a.isSpeaking = false;
    a.answerPending = false;
    a.onSpeechDoneCallback = null;
  }

  function markSpeechDone() {
    if (!a.isSpeaking) return;

    log('Speech done');
    a.isSpeaking = false;
    a.answerPending = false;
    a.agentState = 'listening';
    a.caption = '';

    const cb = a.onSpeechDoneCallback;
    a.onSpeechDoneCallback = null;
    if (cb) cb();

    // Pull any new assistant turns into the feed (fire-and-forget — the
    // answer text is written to history when the LLM completes, before the
    // speech even finishes, so it's reliably there by now).
    syncAgentHistory();

    // Deferred guest welcomes go first (their batching window already fired
    // mid-speech; if the window is still open, its timer handles the flush).
    // Questions resume on the next lock release — the welcome's own speech
    // ends → markSpeechDone runs again → drainQueue / batch logic below.
    if (!a.welcomeTimer && a.welcomeQueue.length > 0 && flushWelcomes()) {
      broadcastState();
      return;
    }

    if (a.mode === 'sequential') {
      drainQueue();
    } else {
      // batched
      if (a.batchPendingAnswer) {
        a.batchPendingAnswer = false;
        closeBatchWindow();
      } else if (a.batchPhase === 'answering') {
        openBatchWindow();
      }
    }

    broadcastState();
  }

  async function speakNow(text, type) {
    if (!a.agentId) return;

    a.isSpeaking = true;
    a.agentState = 'speaking';
    a.caption = `“${text}”`;
    a.lastSpokenText = text;
    // Echo guard: the TTS of this utterance also arrives back as an agent
    // transcript — remember it so addAgentTranscript doesn't double-post it
    // (the bubble below already puts it in the feed).
    a.recentSpeakTexts.push(normalizeText(text));
    if (a.recentSpeakTexts.length > 8) a.recentSpeakTexts.shift();
    // Everything the avatar says shows in the shared feed. The server knows
    // the text of all /speak utterances up front — no transcript round-trip.
    a.messages.push({
      id: a.nextMsgId++,
      uid: 'agent',
      user: 'AVATAR',
      text,
      kind: 'agent',
      ...(type === 'script' ? { scripted: true } : {}),
    });
    if (a.messages.length > 200) a.messages.shift();
    broadcastState();

    try {
      log(`Speaking (${type}): "${text}"`);
      await agora.speak(a.agentId, text, 'APPEND', true);
    } catch (err) {
      console.error(`[ChannelManager:${a.id}] Speak error:`, err);
      resetSpeechTracking();
      a.agentState = 'listening';
      a.caption = '';
      broadcastState();
    }
  }

  // ---------- sequential ----------

  function drainQueue() {
    if (a.mode !== 'sequential') return;
    if (a.isSpeaking) return; // lock held — will retry from markSpeechDone
    if (a.questionQueue.length === 0) {
      if (a.agentState !== 'idle' && a.agentState !== 'listening') {
        a.agentState = 'listening';
      }
      return;
    }

    const q = a.questionQueue.shift();
    a.isSpeaking = true;
    a.answerPending = true;
    a.answerAnchorId = q.id;       // the answer slots in right under this question
    a.agentState = 'thinking';
    a.caption = `Answering — ${q.text}`;
    broadcastState();

    log(`Think (sequential) from ${q.user}: "${q.text}"`);
    agora.think(a.agentId, q.text).catch((err) => {
      console.error(`[ChannelManager:${a.id}] Think error (sequential):`, err);
      resetSpeechTracking();
      a.questionQueue.unshift(q); // put it back to retry later
      a.agentState = 'listening';
      a.caption = '';
      broadcastState();
    });
  }

  // ---------- batched ----------

  function openBatchWindow() {
    if (a.mode !== 'batched') return;
    if (a.batchTimer) clearTimeout(a.batchTimer);
    a.batchPhase = 'collecting';
    a.batchDeadline = Date.now() + a.collectionWindowMs;
    if (!a.isSpeaking) a.agentState = 'listening';
    a.batchTimer = setTimeout(() => closeBatchWindow(), a.collectionWindowMs);
    broadcastState();
  }

  function closeBatchWindow() {
    if (a.mode !== 'batched') return;
    a.batchTimer = null;

    if (a.batchQuestions.length === 0) {
      // Nobody asked anything — silently reopen a fresh window.
      openBatchWindow();
      return;
    }

    if (a.isSpeaking) {
      // Agent is mid-utterance (e.g. a host script). Defer answering the batch
      // until the speech lock releases in markSpeechDone.
      a.batchPendingAnswer = true;
      return;
    }

    const batch = a.batchQuestions;
    a.batchQuestions = [];
    a.batchPhase = 'answering';
    a.isSpeaking = true;
    a.answerPending = true;
    // The answer belongs after the last message in the feed at dispatch time
    // (the batch's final question) — chats arriving mid-answer stack below.
    a.answerAnchorId = a.messages.length ? a.messages[a.messages.length - 1].id : null;
    a.agentState = 'thinking';
    a.caption = 'Answering the room…';
    a.batchDeadline = null;
    broadcastState();

    const prompt = buildBatchPrompt(batch);
    log(`Think (batched) answering ${batch.length} question(s)`);
    agora.think(a.agentId, prompt).catch((err) => {
      console.error(`[ChannelManager:${a.id}] Think error (batched):`, err);
      resetSpeechTracking();
      a.agentState = 'listening';
      a.caption = '';
      openBatchWindow();
    });
  }

  // ---------- chat / questions ----------

  function sendMessage({ uid, user, text }) {
    a.lastActivityAt = Date.now();
    const clean = (text || '').toString().trim();
    if (!clean) return { accepted: false, reason: 'Empty message' };

    const msg = { id: a.nextMsgId++, uid, user: user || 'Guest', text: clean, kind: 'chat' };
    a.messages.push(msg);
    if (a.messages.length > 200) a.messages.shift(); // cap the feed

    // Every chat message is a question the avatar answers. (Host verbatim lines
    // go through speakScript / "+ Add Script" instead.) Only once the channel is
    // live with an agent attached.
    const isQuestion = a.status === 'LIVE' && !!a.agentId;

    if (isQuestion) {
      if (a.mode === 'sequential') {
        a.questionQueue.push({ id: msg.id, uid, user: msg.user, text: clean });
        broadcastState();
        drainQueue();
        return { accepted: true };
      }
      // batched — buffer for the current window
      a.batchQuestions.push({ uid, user: msg.user, text: clean });
    }

    broadcastState();
    return { accepted: true };
  }

  // ---------- host manual script ----------

  async function speakScript(text) {
    if (!a.agentId) throw new Error('No active agent');
    const clean = (text || '').toString().trim();
    if (!clean) throw new Error('Empty script');

    // speakNow pushes the feed bubble (scripted label comes from the type).
    await speakNow(clean, 'script');
    return { success: true };
  }

  // ---------- agent transcripts ----------
  // The agent's LLM answers are generated inside Agora's pipeline — the server
  // never sees the text directly. Clients receive the real transcript via the
  // toolkit's TRANSCRIPT_UPDATED events and POST each finished turn here.
  // Deduped by turn_id (every connected client posts; first one wins).

  function addAgentTranscript({ turnId, text, interrupted }) {
    const clean = fixPunctuationSpacing((text || '').toString().trim());
    if (clean === '' || turnId == null) return { accepted: false, reason: 'Empty transcript' };

    const key = String(turnId);
    if (a.transcriptTurns.has(key)) return { accepted: true, deduped: true };

    // Skip echoes of server-initiated speech — speakNow already pushed the
    // bubble for welcomes/scripts, so the transcript would be a duplicate.
    // Deliberately does NOT record the turn_id: /speak flows can reuse turn ids.
    if (a.recentSpeakTexts.includes(normalizeText(clean))) {
      return { accepted: true, skipped: 'speak-echo' };
    }

    a.transcriptTurns.add(key);
    const msg = {
      id: a.nextMsgId++,
      uid: 'agent',
      user: 'AVATAR',
      text: clean,
      kind: 'agent',
      ...(interrupted ? { interrupted: true } : {}),
    };
    // Insert the answer right after the question(s) it answers, so chats that
    // arrived mid-answer stay below it in the timeline. Falls back to append.
    const anchorIdx = a.answerAnchorId != null
      ? a.messages.findIndex((m) => m.id === a.answerAnchorId)
      : -1;
    if (anchorIdx >= 0) {
      a.messages.splice(anchorIdx + 1, 0, msg);
      a.answerAnchorId = null; // consumed — later transcripts append normally
    } else {
      a.messages.push(msg);
    }
    if (a.messages.length > 200) a.messages.shift();
    log(`Transcript (turn ${key}${interrupted ? ', interrupted' : ''}): "${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}"`);
    broadcastState();
    return { accepted: true };
  }

  // Server-side (authoritative) source for the avatar's LLM answers: pull the
  // agent's conversation history from Agora's REST API and append any
  // assistant turns we haven't seen. Runs after each speech-done. Client
  // transcript posts (/transcript) remain a redundant secondary source —
  // both funnel through addAgentTranscript, deduped by turn_id.
  async function syncAgentHistory() {
    if (!a.agentId || a.historySyncInFlight) return;
    a.historySyncInFlight = true;
    try {
      const history = await agora.getAgentHistory(a.agentId);
      for (const entry of history?.contents || []) {
        if (entry.role !== 'assistant') continue;
        if (entry.turn_id == null || !entry.content) continue;
        addAgentTranscript({ turnId: entry.turn_id, text: entry.content, interrupted: false });
      }
    } catch (err) {
      console.error(`[ChannelManager:${a.id}] History sync error:`, err.message);
    } finally {
      a.historySyncInFlight = false;
    }
  }

  // ---------- presence ----------

  function heartbeat(uid, name, isHost = false) {
    if (uid == null) return;
    a.lastActivityAt = Date.now();
    const key = String(uid);
    const isNew = !a.participants.has(key);
    a.participants.set(key, { name: name || 'Guest', lastSeen: Date.now() });
    // First heartbeat from a new guest UID = a guest just joined the room.
    if (isNew && !isHost) queueWelcome(key, name || 'Guest');
  }

  // ---------- per-guest welcomes ----------
  // The native greeting_message covers the stream opening (host join); guests
  // are welcomed by name via /speak. Guests arriving within WELCOME_BATCH_MS
  // are announced together; if the avatar is mid-utterance the welcome waits
  // for the speech lock to release (never interrupts).

  function queueWelcome(uid, name) {
    if (a.status !== 'LIVE' || !a.agentId) return;
    // A page refresh mints a NEW uid but keeps the name — dedupe on both so
    // reloading a tab doesn't re-welcome the same person.
    const nameKey = name.trim().toLowerCase();
    if (a.welcomedKeys.has(uid) || a.welcomedKeys.has(nameKey)) return;
    a.welcomedKeys.add(uid);
    a.welcomedKeys.add(nameKey);
    a.welcomeQueue.push(name.trim());
    log(`Welcome queued for ${name} (${a.welcomeQueue.length} pending)`);
    if (!a.welcomeTimer) {
      a.welcomeTimer = setTimeout(() => flushWelcomes(), WELCOME_BATCH_MS);
    }
  }

  // Returns true if it took the speech lock to announce the welcome(s).
  function flushWelcomes() {
    if (a.welcomeTimer) {
      clearTimeout(a.welcomeTimer);
      a.welcomeTimer = null;
    }
    if (a.welcomeQueue.length === 0) return false;
    if (a.isSpeaking) return false; // deferred — markSpeechDone retries on release
    const names = a.welcomeQueue;
    a.welcomeQueue = [];
    speakNow(buildWelcome(names), 'welcome');
    return true;
  }

  // ---------- public methods ----------

  function notifyAgentState(state, turnID) {
    a.lastActivityAt = Date.now();
    log(`Agent state: ${state} (turn ${turnID ?? '∅'})`);

    if (!IDLE_STATES.has(state)) return; // speaking or thinking — keep the lock
    if (!a.isSpeaking) return;

    // Time-based dedupe for N clients reporting the same transition at once.
    // Don't use turnID — with the /speak-only flow the turnID stays at 1 forever.
    const now = Date.now();
    if (now - a.lastStateNotificationAt < 300) return;
    a.lastStateNotificationAt = now;

    markSpeechDone();
  }

  async function start(optionsArg) {
    if (a.status !== 'IDLE') {
      throw new Error(`Cannot start channel — current status is ${a.status}`);
    }

    const options = optionsArg ?? {};
    const avatarVendor = options.avatarVendor || a.pendingOptions?.avatarVendor || 'none';
    const ttsVendor = options.ttsVendor || a.pendingOptions?.ttsVendor;
    const ttsSpeed = options.ttsSpeed || a.pendingOptions?.ttsSpeed;
    // The host tab's RTC UID. Listed in remote_rtc_uids so the agent detects the
    // host joining (fires the native greeting) and can idle out after they leave.
    const hostUid = options.hostUid;

    a.config = { ttsVendor, avatarVendor, ttsSpeed };
    a.enableAvatar = avatarVendor !== 'none';
    a.lastActivityAt = Date.now();
    a.pendingOptions = null;

    const systemPrompt = buildHostSystemPrompt(a.channelTitle, a.topic);
    const agentName = `host-${Date.now()}`;

    const joinResult = await agora.joinAgent(a.channelName, agentName, ttsVendor, avatarVendor, {
      ttsSpeed,
      systemPrompt,
      greeting: buildGreeting(a.channelTitle),
      remoteUids: hostUid != null ? [hostUid] : undefined,
    });
    a.agentId = joinResult.agent_id;

    // No warm-up sleep here: nothing speaks at start. The greeting is fired by
    // Agora itself when the host's RTC join is detected, and by then the TTS
    // pipeline is up. (The old 1500ms sleep predated the native greeting and
    // only delayed LIVE → host join → greeting.)
    a.status = 'LIVE';
    a.agentState = 'listening';

    // The agent greets the room natively via properties.llm.greeting_message
    // (set in joinAgent) — Agora speaks it when the first user joins, decoupled
    // from our speech lock. Batched: open the first collection window now.
    if (a.mode === 'batched') {
      openBatchWindow();
    } else {
      broadcastState();
    }

    return {
      agentId: a.agentId,
      channelName: a.channelName,
      mode: a.mode,
      status: a.status,
    };
  }

  async function stop() {
    log(`stop called. agentId=${a.agentId}, status=${a.status}`);
    if (a.batchTimer) {
      clearTimeout(a.batchTimer);
      a.batchTimer = null;
    }
    if (a.welcomeTimer) {
      clearTimeout(a.welcomeTimer);
      a.welcomeTimer = null;
    }
    a.welcomeQueue = [];
    resetSpeechTracking();

    if (a.agentId) {
      try {
        await agora.leaveAgent(a.agentId);
        log('leaveAgent succeeded');
      } catch (err) {
        console.error(`[ChannelManager:${a.id}] Error leaving agent:`, err);
      }
      a.agentId = null;
    }

    a.lastSpokenText = null;
    a.caption = '';
    a.agentState = 'idle';
    a.status = 'CLOSED';
    a.lastActivityAt = Date.now();
    broadcastState();

    return { success: true };
  }

  return {
    id: a.id,
    notifyAgentState,
    start,
    stop,
    sendMessage,
    speakScript,
    addAgentTranscript,
    heartbeat,
    getState,
  };
}

// --- Periodic sweep of stale channels ---
// Guarded by globalThis so HMR doesn't multiply the timer.

if (!globalThis.__channelSweepStarted) {
  globalThis.__channelSweepStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const a of CHANNELS.values()) {
      const idleAge = now - a.lastActivityAt;
      const isClosed = a.status === 'CLOSED';
      const isIdle = a.status === 'IDLE';
      const threshold = isClosed ? CLOSED_EVICTION_AGE_MS : IDLE_EVICTION_AGE_MS;
      if ((isClosed || isIdle) && idleAge > threshold) {
        console.log(`[ChannelManager:${a.id}] Sweep: evicting (${a.status} for ${Math.round(idleAge / 60000)} min)`);
        deleteChannel(a.id).catch((err) => {
          console.error(`[ChannelManager:${a.id}] Sweep delete failed:`, err);
        });
      }
    }
  }, SWEEP_INTERVAL_MS);
}

// --- One-time orphan agent reconciliation on process start ---
// On serverless restarts / dev reloads, the channels Map is empty but Agora may
// still have agents running from the previous process. Find any agent whose
// name matches our host-* pattern that we don't know about, and leave it.

// SKIP on Vercel/serverless: multiple instances run concurrently, each with its
// own (initially empty) Map — a cold start would reap OTHER instances' live
// agents. The agents' idle_timeout (600s) bounds orphan cost there instead.
if (!globalThis.__channelOrphanSweepDone && !process.env.VERCEL) {
  globalThis.__channelOrphanSweepDone = true;
  reconcileOrphanAgents().catch((err) => {
    console.error('[ChannelManager] Orphan reconciliation error:', err);
  });
}

async function reconcileOrphanAgents() {
  try {
    const result = await agora.listAgents(50);
    const agents = result?.data?.list || [];
    const running = agents.filter((x) => x.status === 'RUNNING' || x.status === 'STARTING' || x.status === 'RECOVERING');
    const known = new Set();
    for (const a of CHANNELS.values()) {
      if (a.agentId) known.add(a.agentId);
    }
    const orphans = running.filter((x) =>
      x.name && x.name.startsWith('host-') && !known.has(x.agent_id)
    );
    if (orphans.length === 0) {
      console.log('[ChannelManager] Orphan sweep: nothing to clean up');
      return;
    }
    console.log(`[ChannelManager] Orphan sweep: leaving ${orphans.length} agent(s)`);
    for (const x of orphans) {
      try {
        await agora.leaveAgent(x.agent_id);
        console.log(`  [orphan] ${x.agent_id} (${x.name}) — left`);
      } catch (err) {
        console.error(`  [orphan] ${x.agent_id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[ChannelManager] Orphan list failed (skipping reconciliation):', err.message);
  }
}
