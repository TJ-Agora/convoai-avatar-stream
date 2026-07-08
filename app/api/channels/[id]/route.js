import { NextResponse } from 'next/server';
import { getChannel, getChannelByHostToken, deleteChannel } from '../../../../lib/channelManager.js';

/**
 * Host-initiated immediate deletion. Clears timers, leaves the Agora agent if
 * still running, removes from both Maps. Idempotent.
 *
 *   DELETE /api/channels/{id}        — requires X-Channel-Host-Token
 */
export async function DELETE(request, { params }) {
  try {
    const { id } = params;
    const hostToken = request.headers.get('x-channel-host-token');
    const hostChannel = await getChannelByHostToken(hostToken);

    if (!hostChannel || hostChannel.id !== id) {
      const stillExists = !!(await getChannel(id));
      if (stillExists) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.json({ success: true, alreadyGone: true });
    }

    await deleteChannel(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting channel:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
