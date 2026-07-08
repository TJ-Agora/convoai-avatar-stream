import { NextResponse } from 'next/server';
import { listAgents, leaveAgent } from '../../../../lib/agoraService.js';

export async function POST() {
  try {
    const result = await listAgents(50);
    const agents = result.data?.list || [];
    const running = agents.filter((a) => a.status === 'RUNNING');

    const results = await Promise.allSettled(
      running.map((a) => leaveAgent(a.agent_id))
    );

    const stopped = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    return NextResponse.json({ stopped, failed, total: running.length });
  } catch (error) {
    console.error('Error stopping all agents:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
