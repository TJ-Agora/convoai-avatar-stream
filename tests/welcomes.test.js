import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { channelTracker, liveChannel, forceDeadline } from './helpers/testUtils.js';

const t = channelTracker();
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

const welcomes = () => agoraMock.calls.speak.filter((c) => c.text.startsWith('Welcome'));

describe('per-guest welcomes', () => {
  it('welcomes a new guest after the batching window (deadline-driven)', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.heartbeat('5001', 'Mike');
    expect(welcomes()).toHaveLength(0); // window still open

    await forceDeadline(id, 'welcomeDeadline');
    await channel.tick();
    expect(welcomes()).toHaveLength(1);
    expect(welcomes()[0].text).toBe('Welcome Mike to the stream!');
  });

  it('batches guests who arrive within the window into one announcement', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.heartbeat('5001', 'Mike');
    await channel.heartbeat('5002', 'Sarah');
    await channel.heartbeat('5003', 'Joe');
    await forceDeadline(id, 'welcomeDeadline');
    await channel.tick();
    expect(welcomes()).toHaveLength(1);
    expect(welcomes()[0].text).toBe('Welcome Mike, Sarah, and Joe to the stream!');
  });

  it('dedupes by uid AND name (a tab refresh mints a new uid)', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.heartbeat('5001', 'Mike');
    await forceDeadline(id, 'welcomeDeadline');
    await channel.tick();
    await channel.notifyAgentState('idle');
    expect(welcomes()).toHaveLength(1);

    await channel.heartbeat('5001', 'Mike');  // same uid heartbeat (normal 15s beat)
    await channel.heartbeat('9999', 'Mike');  // refresh: new uid, same name
    await forceDeadline(id, 'welcomeDeadline');
    await channel.tick();
    expect(welcomes()).toHaveLength(1); // no re-welcome
  });

  it('does not welcome the host', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.heartbeat('8888', 'Host', true);
    await forceDeadline(id, 'welcomeDeadline');
    await channel.tick();
    expect(welcomes()).toHaveLength(0);
    const s = await channel.getState();
    expect(s.presence).toBe(1); // still counted in presence
  });

  it('defers a welcome that lands mid-speech until the lock releases', async () => {
    const { id, channel } = await liveChannel(t, { mode: 'sequential' });
    await channel.speakScript('occupying the lock');
    await channel.heartbeat('5001', 'Mike');
    await forceDeadline(id, 'welcomeDeadline');
    await channel.tick();
    expect(welcomes()).toHaveLength(0); // deferred — never interrupts

    await channel.notifyAgentState('idle');
    expect(welcomes()).toHaveLength(1);
  });
});
