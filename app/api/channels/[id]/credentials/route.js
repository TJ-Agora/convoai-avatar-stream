import { NextResponse } from 'next/server';
import { getChannel, getChannelByHostToken } from '../../../../../lib/channelManager.js';
import { generateClientCredentials } from '../../../../../lib/tokenService.js';

/**
 * Mint a fresh per-client RTC + RTM token pair for joining the channel's
 * RTC/RTM channels. Each call returns a brand-new UID so concurrent guests
 * don't collide.
 *
 *   GET /api/channels/{id}/credentials?role=guest   — public
 *   GET /api/channels/{id}/credentials?role=host    — requires X-Channel-Host-Token
 */
export async function GET(request, { params }) {
  try {
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role') || 'guest';

    if (role === 'host') {
      const hostToken = request.headers.get('x-channel-host-token');
      const hostChannel = getChannelByHostToken(hostToken);
      if (!hostChannel || hostChannel.id !== id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      const channel = getChannel(id);
      if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Random UID well outside the reserved range for agent/avatar (100/101/102).
    // The host gets a PUBLISHER token so it can join RTC as a broadcaster
    // (visible to the agent — required for the native greeting to fire).
    const uid = 1_000_000 + Math.floor(Math.random() * 9_000_000);
    const { rtcToken, rtmToken } = generateClientCredentials(id, uid, role === 'host' ? 'publisher' : 'subscriber');

    return NextResponse.json({
      uid,
      rtcToken,
      rtmToken,
      channelName: id,
      role,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error generating credentials:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
