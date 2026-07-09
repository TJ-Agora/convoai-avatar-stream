import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { channelTracker, liveChannel } from './helpers/testUtils.js';

const t = channelTracker();
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

describe('agent transcripts → chat feed', () => {
  it('dedupes by turn_id and fixes punctuation spacing', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    const r1 = await channel.addAgentTranscript({ turnId: 3, text: 'Paris!It has rich history,architecture,and 3.14 pies.' });
    expect(r1.accepted).toBe(true);
    const r2 = await channel.addAgentTranscript({ turnId: 3, text: 'Paris!It has rich history…' });
    expect(r2.deduped).toBe(true);

    const s = await channel.getState();
    const agentMsgs = s.messages.filter((m) => m.kind === 'agent');
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
    const order = s.messages.map((m) => m.text);
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
    const agentMsgs = s.messages.filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].text).toBe('The capital of France is Paris!');
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
