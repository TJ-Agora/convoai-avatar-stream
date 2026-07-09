import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { getChannel, getChannelByHostToken, deleteChannel, listChannels } from '../lib/channelManager.js';
import { channelTracker } from './helpers/testUtils.js';

const t = channelTracker();
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

describe('channel lifecycle', () => {
  it('creates a channel with urls, id, and host token', async () => {
    const c = await t.make({ channelTitle: 'Test Stream', mode: 'sequential' });
    expect(c.id).toMatch(/^[a-z0-9]{8}$/);
    expect(c.hostToken).toHaveLength(32);
    expect(c.guestUrl).toBe(`/stream/${c.id}`);
    expect(c.hostUrl).toBe(`/manage/${c.hostToken}`);
  });

  it('getState returns the snapshot shape', async () => {
    const c = await t.make({ channelTitle: 'Shape', mode: 'batched', collectionWindowMs: 10000 });
    const channel = await getChannel(c.id);
    const s = await channel.getState();
    expect(s.type).toBe('state');
    expect(s.status).toBe('IDLE');
    expect(s.mode).toBe('batched');
    expect(s.collectionWindowMs).toBe(10000);
    expect(s.channelTitle).toBe('Shape');
    expect(s.messages).toEqual([]);
    expect(s.queue).toEqual([]);
    expect(s.presence).toBe(0);
  });

  it('resolves host token to the channel and rejects unknown tokens', async () => {
    const c = await t.make({});
    const viaToken = await getChannelByHostToken(c.hostToken);
    expect(viaToken?.id).toBe(c.id);
    expect(await getChannelByHostToken('nope-not-a-token')).toBeNull();
  });

  it('lists created channels', async () => {
    const c = await t.make({ channelTitle: 'Listed' });
    const all = await listChannels();
    expect(all.some((x) => x.id === c.id)).toBe(true);
  });

  it('messages while IDLE are chat-only (no think, no queue)', async () => {
    const c = await t.make({ mode: 'sequential' });
    const channel = await getChannel(c.id);
    await channel.sendMessage({ uid: '1', user: 'Mike', text: 'hello before start' });
    const s = await channel.getState();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].kind).toBe('chat');
    expect(s.queue).toHaveLength(0);
    expect(agoraMock.calls.think).toHaveLength(0);
  });

  it('delete removes the channel and its token', async () => {
    const c = await t.make({});
    await deleteChannel(c.id);
    expect(await getChannel(c.id)).toBeNull();
    expect(await getChannelByHostToken(c.hostToken)).toBeNull();
  });
});
