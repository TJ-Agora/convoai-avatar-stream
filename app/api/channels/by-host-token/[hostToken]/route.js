import { NextResponse } from 'next/server';
import { getChannelByHostToken } from '../../../../../lib/channelManager.js';

/**
 * Resolve a host token to its channel ID + current state. Used by the
 * /manage/[hostToken] page to bootstrap itself.
 */
export async function GET(_request, { params }) {
  const { hostToken } = params;
  const channel = getChannelByHostToken(hostToken);
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ id: channel.id, state: channel.getState() });
}
