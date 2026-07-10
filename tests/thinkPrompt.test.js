import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { channelTracker, liveChannel, meta } from './helpers/testUtils.js';

const t = channelTracker();
const noGreeting = (msgs) => msgs.filter((m) => !(m.text || '').startsWith('Hey everyone'));
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

describe('host think prompts (/think scripts)', () => {
  it('idle avatar: dispatches /think immediately, nothing in the feed', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });
    const r = await channel.thinkScript('Comment on how great the weather is today.');
    expect(r.success).toBe(true);
    expect(r.queued).toBeUndefined();

    expect(agoraMock.calls.think).toHaveLength(1);
    expect(agoraMock.calls.think[0].text).toBe('Comment on how great the weather is today.');

    // "Answer only": the prompt text never appears in the feed or caption,
    // and no anchor is set — the answer will append at the feed end.
    const s = await channel.getState();
    expect(noGreeting(s.messages)).toHaveLength(0);
    const m = await meta(id);
    expect(String(m.isSpeaking)).toBe('true');
    expect(Number(m.answerAnchorId)).toBe(0);
    expect(m.caption).toBeFalsy();
  });

  it('answer arrives via history sync as a normal agent turn', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.thinkScript('Talk about coffee.');
    agoraMock.setHistory([{ role: 'assistant', content: 'I love coffee, folks!', turn_id: 1 }]);
    await channel.notifyAgentState('idle');

    const s = await channel.getState();
    const agentMsgs = noGreeting(s.messages).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].text).toBe('I love coffee, folks!');
    expect(agentMsgs[0].scripted).toBeUndefined(); // reads as a normal agent turn
  });

  it('busy avatar: prompt queues and dispatches on speech release, before the guest queue', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'Q1' }); // dispatches, lock held
    await channel.sendMessage({ uid: '2', user: 'Sarah', text: 'Q2' }); // queued behind the lock

    const r = await channel.thinkScript('Plug the merch store.');
    expect(r.queued).toBe(true);
    expect(agoraMock.calls.think).toHaveLength(1); // still only Q1

    // Q1's speech ends → the host prompt jumps ahead of Q2.
    agoraMock.setHistory([{ role: 'assistant', content: 'A1', turn_id: 1 }]);
    await channel.notifyAgentState('idle');
    expect(agoraMock.calls.think).toHaveLength(2);
    expect(agoraMock.calls.think[1].text).toBe('Plug the merch store.');

    // Prompt's speech ends → Q2 finally dispatches.
    await channel.notifyAgentState('idle');
    expect(agoraMock.calls.think).toHaveLength(3);
    expect(agoraMock.calls.think[2].text).toContain('Q2');
  });

  it('batched mode: prompt while answering defers, then the window reopens after', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'batched', collectionWindowMs: 10000 });
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'batch Q' });
    const { forceDeadline } = await import('./helpers/testUtils.js');
    await forceDeadline(id, 'batchDeadline');
    await channel.tick(); // window closes → batch /think dispatched, lock held
    expect(agoraMock.calls.think).toHaveLength(1);

    await channel.thinkScript('Remind everyone to subscribe.');
    expect(agoraMock.calls.think).toHaveLength(1); // deferred

    await channel.notifyAgentState('idle'); // batch answer done → prompt dispatches
    expect(agoraMock.calls.think).toHaveLength(2);
    expect(agoraMock.calls.think[1].text).toBe('Remind everyone to subscribe.');

    await channel.notifyAgentState('idle'); // prompt done → window reopens
    const m = await meta(id);
    expect(m.batchPhase).toBe('collecting');
    expect(Number(m.batchDeadline)).toBeGreaterThan(Date.now());
  });

  it('prompt stranded by an idle lock-contender is recovered by tick()', async () => {
    const { acquireLock, releaseLock, lockKey } = await import('../lib/channelStore.js');
    const { channel, id } = await liveChannel(t, { mode: 'batched', collectionWindowMs: 10000 });

    // Simulate an idle contender (e.g. a /state tick closing an empty batch
    // window): hold the dispatch lock through thinkScript's retry, so the
    // prompt queues — and since the holder never speaks, no speech release
    // will ever drain it.
    await acquireLock(lockKey(id, 'dispatch'), 10000);
    await channel.thinkScript('Shout out the sponsors.');
    expect(agoraMock.calls.think).toHaveLength(0); // queued, not dispatched
    await releaseLock(lockKey(id, 'dispatch'));

    // Any hot-route tick recovers it — no speech release required.
    await channel.tick();
    expect(agoraMock.calls.think).toHaveLength(1);
    expect(agoraMock.calls.think[0].text).toBe('Shout out the sponsors.');
  });

  it('rejects when there is no active agent', async () => {
    const c = await t.make({ mode: 'sequential' });
    const { getChannel } = await import('../lib/channelManager.js');
    const channel = await getChannel(c.id);
    await expect(channel.thinkScript('hello')).rejects.toThrow('No active agent');
  });
});

describe('lemonslice avatar vendor', () => {
  it('createChannel(avatarVendor=lemonslice) passes the vendor through to joinAgent', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential', avatarVendor: 'lemonslice' });
    expect(agoraMock.calls.join).toHaveLength(1);
    expect(agoraMock.calls.join[0].avatarVendor).toBe('lemonslice');
    expect((await channel.getState()).status).toBe('LIVE');
  });
});
