import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/authGuard.js';
import { getChannelByHostToken } from '../../../../../lib/channelManager.js';

/**
 * Host-only LLM prompt. The text is sent to /think — the avatar reacts to it
 * in its own words. The prompt itself never appears in the feed; the answer
 * arrives like any other agent turn. If the avatar is mid-utterance the
 * prompt queues and dispatches on the next speech release.
 *
 *   POST /api/channels/{id}/think    — requires X-Channel-Host-Token
 */
export async function POST(request, { params }) {
  try {
    const { deny } = await requireSession();
    if (deny) return deny;
    const { id } = params;
    const hostToken = request.headers.get('x-channel-host-token');
    const hostChannel = await getChannelByHostToken(hostToken);
    if (!hostChannel || hostChannel.id !== id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { text } = await request.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 });
    }

    const result = await hostChannel.thinkScript(text.trim());
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending think prompt:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
