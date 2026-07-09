import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { channelTracker, liveChannel } from './helpers/testUtils.js';

const t = channelTracker();
const noGreeting = (msgs) => msgs.filter((m) => !(m.text || '').startsWith('Hey everyone'));
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

describe('agent transcripts → chat feed', () => {
  it('dedupes by turn_id and fixes punctuation spacing', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    const r1 = await channel.addAgentTranscript({ turnId: 3, text: 'Paris!It has rich history,architecture,and 3.14 pies.' });
    expect(r1.accepted).toBe(true);
    const r2 = await channel.addAgentTranscript({ turnId: 3, text: 'Paris!It has rich history…' });
    expect(r2.deduped).toBe(true);

    const s = await channel.getState();
    const agentMsgs = noGreeting(s.messages).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].text).toBe('Paris! It has rich history, architecture, and 3.14 pies.');
  });

  it('echo guard: transcripts of /speak utterances are skipped without consuming the turn', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.speakScript('Hello wonderful room');
    // The script's own TTS transcript comes back — must not double-post.
    const echo = await channel.addAgentTranscript({ turnId: 1, text: 'Hello wonderful room' });
    expect(echo.skipped).toBe('speak-echo');
    // The same turn id later carries a REAL answer (speak flows reuse turn ids).
    const real = await channel.addAgentTranscript({ turnId: 1, text: 'A genuine answer to something.' });
    expect(real.accepted).toBe(true);
    expect(real.deduped).toBeUndefined();

    const s = await channel.getState();
    const texts = s.messages.map((m) => m.text);
    expect(texts.filter((x) => x === 'Hello wonderful room')).toHaveLength(1); // script bubble only
    expect(texts).toContain('A genuine answer to something.');
  });

  it('anchors the answer under its question; mid-answer chat stays below', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'the question' });   // dispatches, sets anchor
    await channel.sendMessage({ uid: '2', user: 'Sarah', text: 'mid-answer chat' }); // queued, lands in feed now
    await channel.addAgentTranscript({ turnId: 2, text: 'the answer' });

    const s = await channel.getState();
    const order = noGreeting(s.messages).map((m) => m.text);
    expect(order).toEqual(['the question', 'the answer', 'mid-answer chat']);
  });

  it('history sync on speech-done pulls assistant turns into the feed', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'capital of France?' });
    agoraMock.setHistory([
      { role: 'user', content: 'capital of France?', turn_id: 1 },
      { role: 'assistant', content: 'The capital of France is Paris!', turn_id: 1 },
    ]);
    await channel.notifyAgentState('idle'); // markSpeechDone → syncAgentHistory

    const s = await channel.getState();
    const agentMsgs = noGreeting(s.messages).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].text).toBe('The capital of France is Paris!');
  });

  it("greeting bubble lands at start; its (mangled) transcript can't steal the answer anchor", async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });

    // start() pushed the greeting bubble immediately.
    let s = await channel.getState();
    expect(s.messages.filter((m) => (m.text || '').startsWith('Hey everyone'))).toHaveLength(1);

    // A question dispatches and sets the answer anchor.
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'the question' });

    // The greeting's transcript arrives — Agora-mangled (spaces dropped after
    // punctuation). It must be echo-skipped: no duplicate bubble, anchor intact.
    const echo = await channel.addAgentTranscript({
      turnId: 0,
      text: "Hey everyone,welcome!I'm your host.Drop your questions in the chat and I'll answer them live.",
    });
    expect(echo.skipped).toBe('speak-echo');

    // The real answer still lands at its anchor — right under the question.
    await channel.addAgentTranscript({ turnId: 1, text: 'the answer' });
    s = await channel.getState();
    expect(noGreeting(s.messages).map((m) => m.text)).toEqual(['the question', 'the answer']);
    expect(s.messages.filter((m) => (m.text || '').startsWith('Hey everyone'))).toHaveLength(1);
  });

  it('back-to-back questions: each answer lands under ITS question (sync before next dispatch)', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'Q1' });   // dispatches, anchor=Q1
    await channel.sendMessage({ uid: '2', user: 'Sarah', text: 'Q2' });  // queued, in feed

    // A1 is in history when Q1's speech ends. markSpeechDone must land A1 at
    // Q1's anchor BEFORE drainQueue dispatches Q2 (which overwrites the anchor).
    agoraMock.setHistory([{ role: 'assistant', content: 'A1', turn_id: 1 }]);
    await channel.notifyAgentState('idle');

    agoraMock.setHistory([
      { role: 'assistant', content: 'A1', turn_id: 1 },
      { role: 'assistant', content: 'A2', turn_id: 2 },
    ]);
    await channel.notifyAgentState('idle');

    const s = await channel.getState();
    expect(noGreeting(s.messages).map((m) => m.text)).toEqual(['Q1', 'A1', 'Q2', 'A2']);
  });

  it('broadcast revs are strictly increasing', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.sendMessage({ uid: '1', user: 'A', text: 'q1' });
    await channel.notifyAgentState('idle');
    await channel.sendMessage({ uid: '2', user: 'B', text: 'plain chat' });

    const revs = agoraMock.calls.broadcasts.map((b) => b.payload.rev);
    expect(revs.length).toBeGreaterThan(2);
    for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
  });
});
