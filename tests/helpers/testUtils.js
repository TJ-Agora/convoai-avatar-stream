import { createChannel, getChannel, deleteChannel } from '../../lib/channelManager.js';
import { redis, k } from '../../lib/channelStore.js';

/**
 * Tracks channels created in a test file and tears them down afterEach, so the
 * shared Upstash DB stays clean no matter how a test exits.
 */
export function channelTracker() {
  const made = [];
  return {
    async make(opts = {}) {
      const c = await createChannel(opts);
      made.push(c.id);
      return c;
    },
    async cleanup() {
      while (made.length) {
        try { await deleteChannel(made.pop()); } catch { /* already gone */ }
      }
    },
  };
}

/** Started channel helper: create + start (mock agent) and return handles. */
export async function liveChannel(tracker, opts = {}) {
  const { id, hostToken } = await tracker.make({ avatarVendor: 'anam', ttsVendor: 'preset_minimax', ...opts });
  const channel = await getChannel(id);
  await channel.start({ hostUid: 7000001 });
  return { id, hostToken, channel };
}

/** Force a stored deadline into the past so tick() fires without sleeping. */
export async function forceDeadline(id, field) {
  await redis.hset(k(id, 'meta'), { [field]: Date.now() - 1000 });
}

export async function meta(id) {
  return await redis.hgetall(k(id, 'meta'));
}
