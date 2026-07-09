import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { channelTracker, liveChannel, meta } from './helpers/testUtils.js';

const t = channelTracker();
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

describe('sequential mode', () => {
  it('answers one question at a time via the speech lock', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });

    // Q1 dispatches immediately.
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'first question' });
    expect(agoraMock.calls.think).toHaveLength(1);
    expect(agoraMock.calls.think[0].text).toBe('first question');
    expect((await meta(id)).isSpeaking).toBe(true);

    // Q2 queues — the lock is held.
    await channel.sendMessage({ uid: '2', user: 'Sarah', text: 'second question' });
    expect(agoraMock.calls.think).toHaveLength(1);
    let s = await channel.getState();
    expect(s.queue).toHaveLength(1);
    expect(s.answerPending).toBe(true);

    // Speech ends → lock releases → Q2 drains.
    await channel.notifyAgentState('idle');
    expect(agoraMock.calls.think).toHaveLength(2);
    expect(agoraMock.calls.think[1].text).toBe('second question');

    // Final release → queue empty, listening.
    await channel.notifyAgentState('idle');
    s = await channel.getState();
    expect(s.queue).toHaveLength(0);
    expect(s.isSpeaking).toBe(false);
  });

  it('concurrent speech-done notifications drain exactly one question', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.sendMessage({ uid: '1', user: 'A', text: 'q1' });
    await channel.sendMessage({ uid: '2', user: 'B', text: 'q2' });
    await channel.sendMessage({ uid: '3', user: 'C', text: 'q3' });
    expect(agoraMock.calls.think).toHaveLength(1); // q1 in flight, q2+q3 queued

    // N clients report the same transition simultaneously.
    await Promise.all([
      channel.notifyAgentState('idle'),
      channel.notifyAgentState('idle'),
      channel.notifyAgentState('idle'),
    ]);
    // Exactly one more dispatch (q2) — not q3 too.
    expect(agoraMock.calls.think).toHaveLength(2);
    const s = await channel.getState();
    expect(s.queue).toHaveLength(1);
  });

  it('ignores mid-cycle states (speaking/thinking keep the lock)', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.sendMessage({ uid: '1', user: 'A', text: 'q1' });
    await channel.notifyAgentState('thinking');
    await channel.notifyAgentState('speaking');
    expect((await meta(id)).isSpeaking).toBe(true);
    expect(agoraMock.calls.think).toHaveLength(1);
  });
});
