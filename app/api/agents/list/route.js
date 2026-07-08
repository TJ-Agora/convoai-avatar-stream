import { NextResponse } from 'next/server';
import { listAgents } from '../../../../lib/agoraService.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await listAgents(50);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    console.error('Error listing agents:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
