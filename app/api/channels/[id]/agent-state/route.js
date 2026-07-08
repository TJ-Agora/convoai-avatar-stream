import { NextResponse } from 'next/server';
import { getChannel } from '../../../../../lib/channelManager.js';

/**
 * Clients notify the server when the agent stops speaking (via the RTM
 * state.speaking=false event). This drives the server-side speech lock, which
 * in turn advances the sequential queue / opens the next batch window.
 */
export async function POST(request, { params }) {
  try {
    const { id } = params;
    const channel = getChannel(id);
    if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { state, turnID } = await request.json();
    if (!state) return NextResponse.json({ error: 'Missing state' }, { status: 400 });

    channel.notifyAgentState(state, turnID);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in agent-state:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
