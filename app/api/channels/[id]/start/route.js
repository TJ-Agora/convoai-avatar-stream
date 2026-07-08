import { NextResponse } from 'next/server';
import { getChannelByHostToken } from '../../../../../lib/channelManager.js';

export async function POST(request, { params }) {
  try {
    const { id } = params;
    const hostToken = request.headers.get('x-channel-host-token');
    const hostChannel = getChannelByHostToken(hostToken);
    if (!hostChannel || hostChannel.id !== id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // hostUid = the host tab's RTC UID; the agent watches it for join/leave
    // (native greeting + idle detection).
    const { hostUid } = await request.json().catch(() => ({}));
    const result = await hostChannel.start({ hostUid });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error starting channel:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
