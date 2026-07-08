import { NextResponse } from 'next/server';
import { getChannel } from '../../../../../lib/channelManager.js';

/**
 * Clients post the agent's finished turn transcripts here (received via the
 * toolkit's TRANSCRIPT_UPDATED events). The server appends them to the shared
 * chat feed. Every connected client posts the same turn — the server dedupes
 * by turn_id, so this is safe to call redundantly (same trust model as the
 * /agent-state notifications).
 *
 *   POST /api/channels/{id}/transcript   body: { turnId, text, interrupted }
 */
export async function POST(request, { params }) {
  try {
    const { id } = params;
    const channel = getChannel(id);
    if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { turnId, text, interrupted } = await request.json();
    const result = channel.addAgentTranscript({ turnId, text, interrupted: !!interrupted });
    if (!result.accepted) {
      return NextResponse.json({ error: result.reason || 'Rejected' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error posting transcript:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
