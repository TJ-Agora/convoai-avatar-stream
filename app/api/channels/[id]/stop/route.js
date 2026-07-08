import { NextResponse } from 'next/server';
import { getChannelByHostToken } from '../../../../../lib/channelManager.js';

export async function POST(request, { params }) {
  try {
    const { id } = params;
    const hostToken = request.headers.get('x-channel-host-token');
    const hostChannel = await getChannelByHostToken(hostToken);
    if (!hostChannel || hostChannel.id !== id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await hostChannel.stop();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error stopping channel:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
