import { NextResponse } from 'next/server';
import { getChannel, tickChannel } from '../../../../../lib/channelManager.js';

// Disable Next.js route caching so the client poll always gets fresh state.
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { id } = params;
  await tickChannel(id);
  const channel = await getChannel(id);
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await channel.getState(), {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
