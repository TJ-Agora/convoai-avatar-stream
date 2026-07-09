import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { channelTracker, liveChannel, forceDeadline, meta } from './helpers/testUtils.js';

const t = channelTracker();
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

describe('batched mode', () => {
  it('opens a collection window on start and buffers questions without dispatching', async () => {
    const { channel } = await liveChannel(t, { mode: 'batched', collectionWindowMs: 10000 });
    let s = await channel.getState();
    expect(s.batchPhase).toBe('collecting');
    expect(s.batchDeadline).toBeGreaterThan(Date.now());

    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'about july 4th?' });
    await channel.sendMessage({ uid: '2', user: 'Sarah', text: 'favorite holiday?' });
    s = await channel.getState();
    expect(s.batchCount).toBe(2);
    expect(agoraMock.calls.think).toHaveLength(0);
  });

  it('closes the window on a deadline tick with ONE combined think, then reopens after speech', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'batched', collectionWindowMs: 10000 });
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'about july 4th?' });
    await channel.sendMessage({ uid: '2', user: 'Sarah', text: 'favorite holiday?' });

    await forceDeadline(id, 'batchDeadline');
    await channel.tick();

    expect(agoraMock.calls.think).toHaveLength(1);
    const prompt = agoraMock.calls.think[0].text;
    expect(prompt).toContain('Mike: about july 4th?');
    expect(prompt).toContain('Sarah: favorite holiday?');
    expect(prompt).not.toMatch(/\b1\)/); // no numbering — spoken prose prompt

    let s = await channel.getState();
    expect(s.batchPhase).toBe('answering');
    expect(s.isSpeaking).toBe(true);

    // Questions arriving mid-answer belong to the NEXT window.
    await channel.sendMessage({ uid: '3', user: 'Joe', text: 'price?' });
    expect(agoraMock.calls.think).toHaveLength(1);

    await channel.notifyAgentState('idle'); // answer ends → window reopens
    s = await channel.getState();
    expect(s.batchPhase).toBe('collecting');
    expect(s.batchDeadline).toBeGreaterThan(Date.now());
    expect(s.batchCount).toBe(1); // Joe's question carried into the new window
  });

  it('empty window reopens silently without a think', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'batched', collectionWindowMs: 10000 });
    await forceDeadline(id, 'batchDeadline');
    await channel.tick();
    expect(agoraMock.calls.think).toHaveLength(0);
    const s = await channel.getState();
    expect(s.batchPhase).toBe('collecting');
    expect(s.batchDeadline).toBeGreaterThan(Date.now());
  });

  it('defers the close while the avatar is mid-script, then answers on release', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'batched', collectionWindowMs: 10000 });
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'a question' });

    await channel.speakScript('a long host script'); // takes the speech lock
    expect((await meta(id)).isSpeaking).toBe(true);

    await forceDeadline(id, 'batchDeadline');
    await channel.tick();
    expect(agoraMock.calls.think).toHaveLength(0); // deferred, not interrupted
    expect((await meta(id)).batchPendingAnswer).toBe(true);

    await channel.notifyAgentState('idle'); // script ends → deferred batch answers
    expect(agoraMock.calls.think).toHaveLength(1);
    expect(agoraMock.calls.think[0].text).toContain('a question');
  });
});
