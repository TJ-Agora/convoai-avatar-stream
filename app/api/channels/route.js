import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/authGuard.js';
import { createChannel, listChannels } from '../../../lib/channelManager.js';

export async function POST(request) {
  try {
    const { deny } = await requireSession();
    if (deny) return deny;
    const body = await request.json().catch(() => ({}));
    const { channelTitle, topic, mode, collectionWindowMs, ttsVendor, avatarVendor, ttsSpeed } = body;

    const result = await createChannel({ channelTitle, topic, mode, collectionWindowMs, ttsVendor, avatarVendor, ttsSpeed });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error creating channel:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { deny } = await requireSession();
    if (deny) return deny;
    return NextResponse.json({ channels: await listChannels() });
  } catch (error) {
    console.error('Error listing channels:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
