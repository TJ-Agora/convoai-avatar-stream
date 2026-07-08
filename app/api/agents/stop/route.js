import { NextResponse } from 'next/server';
import { leaveAgent } from '../../../../lib/agoraService.js';

export async function POST(request) {
  try {
    const { agentId } = await request.json();
    if (!agentId) {
      return NextResponse.json({ error: 'agentId required' }, { status: 400 });
    }
    await leaveAgent(agentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error stopping agent:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
