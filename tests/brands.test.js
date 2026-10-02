import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../lib/agoraService.js', () => import('./helpers/agoraMock.js'));
import * as agoraMock from './helpers/agoraMock.js';
import { channelTracker, liveChannel, meta } from './helpers/testUtils.js';
import { BRAND_IDS, getBrand, getSeller, buildBatchPrompt } from '../lib/brands.js';

const t = channelTracker();
afterEach(async () => { agoraMock.resetMock(); await t.cleanup(); });

describe('brand registry', () => {
  it('unknown ids fall back to default', () => {
    expect(getBrand('nope').id).toBe('default');
    expect(getBrand(undefined).id).toBe('default');
    expect(getSeller('thredup', 'nope')).toBeNull();
    expect(getSeller('default', 'partner')).toBeNull();
  });

  it('every greeting starts with "Hey everyone" (tests filter the greeting bubble by that prefix)', () => {
    for (const id of BRAND_IDS) {
      const b = getBrand(id);
      expect(b.greeting('My Stream', null)).toMatch(/^Hey everyone/);
      expect(b.greeting('', null)).toMatch(/^Hey everyone/);
      for (const s of b.sellers) expect(b.greeting('My Stream', s)).toMatch(/^Hey everyone/);
    }
  });

  it('batch prompt is brand-aware and never numbered', () => {
    const qs = [{ user: 'Mike', text: 'size?' }, { user: 'Sarah', text: 'fabric?' }];
    const generic = buildBatchPrompt('default', qs);
    const thred = buildBatchPrompt('thredup', qs);
    for (const p of [generic, thred]) {
      expect(p).toContain('Mike: size?');
      expect(p).toContain('Sarah: fabric?');
      expect(p).not.toMatch(/\b1\)/);
    }
    expect(generic).not.toContain('shoppers');
    expect(thred).toContain('shoppers');
  });
});

describe('brand on a channel', () => {
  it('default brand: generic host prompt + greeting, no brand text, no voice override', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential' });
    const { extra } = agoraMock.calls.join[0];
    expect(extra.systemPrompt).toContain('friendly live host');
    expect(extra.systemPrompt).not.toContain('thredUP');
    expect(extra.greeting).toContain("I'm your host");
    expect(extra.voiceId).toBeUndefined();

    const s = await channel.getState();
    expect(s.brand).toBe('default');
    expect(s.seller).toBeNull();
  });

  it('unknown brand id is coerced to default', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential', brand: 'acme' });
    expect((await channel.getState()).brand).toBe('default');
    expect(agoraMock.calls.join[0].extra.systemPrompt).not.toContain('acme');
  });

  it('thredup without a seller: seller-persona prompt, form avatar kept', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential', brand: 'thredup', avatarVendor: 'anam' });
    const join = agoraMock.calls.join[0];
    expect(join.avatarVendor).toBe('anam');
    expect(join.extra.systemPrompt).toContain('thredUP');
    expect(join.extra.systemPrompt).toContain('live seller');
    expect(join.extra.greeting).toContain('secondhand finds');
    expect(join.extra.voiceId).toBeUndefined();

    const s = await channel.getState();
    expect(s.brand).toBe('thredup');
    expect(s.seller).toBeNull();
  });

  it('thredup seller: resolved server-side, overrides form avatar fields, pins voice', async () => {
    const seller = getSeller('thredup', 'partner');
    expect(seller).not.toBeNull();

    // The form's avatar/voice values must NOT survive — the persona wins.
    const { id, channel } = await liveChannel(t, {
      mode: 'sequential', brand: 'thredup', sellerId: 'partner',
      avatarVendor: 'anam', avatarImageUrl: 'https://attacker.example/face.jpg', voiceGender: 'male',
    });
    const join = agoraMock.calls.join[0];
    expect(join.avatarVendor).toBe(seller.avatarVendor);
    expect(join.extra.avatarImageUrl).toBe(seller.avatarImageUrl || undefined);
    expect(join.extra.voiceId).toBe(seller.voiceId || undefined);
    expect(join.extra.systemPrompt).toContain(`You are ${seller.name}`);
    expect(join.extra.systemPrompt).toContain(seller.bio);
    expect(join.extra.greeting).toContain(seller.name);

    const s = await channel.getState();
    expect(s.seller).toEqual({ id: 'partner', name: seller.name });
    const m = await meta(id);
    expect(m.sellerId).toBe('partner');
    expect(m.avatarVendor).toBe(seller.avatarVendor);
  });

  it('invalid sellerId on a valid brand → no seller, form values kept', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential', brand: 'thredup', sellerId: 'ghost', avatarVendor: 'anam' });
    expect(agoraMock.calls.join[0].avatarVendor).toBe('anam');
    expect((await channel.getState()).seller).toBeNull();
  });

  it('sellerId is ignored on a brand with no sellers', async () => {
    const { channel } = await liveChannel(t, { mode: 'sequential', brand: 'default', sellerId: 'partner', avatarVendor: 'anam' });
    expect(agoraMock.calls.join[0].avatarVendor).toBe('anam');
    expect((await channel.getState()).seller).toBeNull();
  });
});
