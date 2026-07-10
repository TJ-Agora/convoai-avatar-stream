// Redis-backed storage layer for channel state (Upstash via Vercel Marketplace).
//
// Why Redis: channel state must be readable/writable from EVERY serverless
// instance — per-process memory (globalThis) splits across Vercel instances.
// Native Redis structures are chosen so hot-path mutations are ATOMIC
// (ZADD/RPUSH/SADD/HSET) instead of read-modify-write races.
//
// Key layout (per channel id):
//   ch:{id}:meta          HASH   scalar fields (status, mode, flags, deadlines, rev, …)
//   ch:{id}:messages      ZSET   feed; member = message object, score = sequence
//                                (fractional scores let answers insert at their anchor)
//   ch:{id}:msgseq        STRING message id counter (INCR)
//   ch:{id}:queue         LIST   sequential-mode question queue
//   ch:{id}:batch         LIST   batched-mode window buffer
//   ch:{id}:participants  HASH   uid → {name, lastSeen}
//   ch:{id}:welcomed      SET    welcome dedupe keys (uids + normalized names)
//   ch:{id}:welcomeq      LIST   names awaiting the welcome announcement
//   ch:{id}:turns         SET    transcript turn_ids already in the feed
//   ch:{id}:speaktexts    LIST   normalized recent /speak texts (echo guard)
//   token:{hostToken}     STRING channel id (host auth reverse index)
//   channels:index        SET    all channel ids (pruned lazily)

import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export const LIVE_TTL_S = 3 * 60 * 60;   // rolling TTL while a channel is active
export const CLOSED_TTL_S = 30 * 60;     // linger after stop() so late polls resolve

const SUFFIXES = ['meta', 'messages', 'msgseq', 'queue', 'batch', 'participants', 'welcomed', 'welcomeq', 'promptq', 'turns', 'speaktexts'];

export const k = (id, suffix) => `ch:${id}:${suffix}`;
export const tokenKey = (t) => `token:${t}`;
export const INDEX_KEY = 'channels:index';

/** Refresh expiry on all of a channel's keys (rolling TTL replaces the sweep). */
export async function touchChannel(id, ttlS = LIVE_TTL_S, hostToken = null) {
  const p = redis.pipeline();
  for (const s of SUFFIXES) p.expire(k(id, s), ttlS);
  if (hostToken) p.expire(tokenKey(hostToken), ttlS);
  await p.exec();
}

/** One-shot cross-instance guard. Returns true if THIS caller holds the lock. */
export async function acquireLock(key, pxMs) {
  const res = await redis.set(key, '1', { nx: true, px: pxMs });
  return res === 'OK';
}

export async function releaseLock(key) {
  try { await redis.del(key); } catch { /* lock will expire anyway */ }
}

export const lockKey = (id, name) => `ch:${id}:lock:${name}`;
