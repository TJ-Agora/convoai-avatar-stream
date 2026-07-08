import { NextResponse } from 'next/server';
import { getChannelByHostToken } from '../../../../../lib/channelManager.js';

/**
 * Host-only manual script. The agent speaks the text verbatim via TTS and it
 * shows in the shared feed as an AGENT · SCRIPTED bubble.
 *
 *   POST /api/channels/{id}/speak    — requires X-Channel-Host-Token
 */
export async function POST(request, { params }) {
  try {
    const { id } = params;
    const hostToken = request.headers.get('x-channel-host-token');
    const hostChannel = getChannelByHostToken(hostToken);
    if (!hostChannel || hostChannel.id !== id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { text } = await request.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 });
    }

    const result = await hostChannel.speakScript(text.trim());
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error speaking script:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
