import { NextResponse } from 'next/server';
import { getChannel, getChannelByHostToken } from '../../../../../lib/channelManager.js';

/**
 * Presence heartbeat. The stream page POSTs this on mount and every ~15s.
 * The server keeps a per-uid lastSeen and reports the live count as "N WATCHING".
 * The FIRST heartbeat from a new guest UID also triggers the per-guest welcome
 * announcement. Host status comes from the X-Channel-Host-Token header (never
 * the body) — the host is counted in presence but not welcomed (the native
 * greeting_message covers the host's arrival).
 *
 *   POST /api/channels/{id}/presence   body: { uid, name }
 */
export async function POST(request, { params }) {
  try {
    const { id } = params;
    const channel = getChannel(id);
    if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { uid, name } = await request.json();
    const hostToken = request.headers.get('x-channel-host-token');
    const isHost = hostToken ? getChannelByHostToken(hostToken)?.id === id : false;

    channel.heartbeat(uid, name, isHost);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in presence:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
