import { NextResponse } from 'next/server';
import { getChannel, tickChannel } from '../../../../../lib/channelManager.js';

/**
 * Post a chat message into the shared room feed. Every message becomes a
 * question the avatar answers (queued in sequential mode, buffered in batched
 * mode) once the channel is live. Host verbatim lines go through /speak instead.
 *
 *   POST /api/channels/{id}/message   body: { uid, user, text }
 */
export async function POST(request, { params }) {
  try {
    const { id } = params;
    await tickChannel(id);
    const channel = await getChannel(id);
    if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { uid, user, text } = await request.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 });
    }

    const result = await channel.sendMessage({ uid, user, text: text.trim() });
    if (!result.accepted) {
      return NextResponse.json({ error: result.reason || 'Rejected' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error posting message:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
