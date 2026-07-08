import { NextResponse } from 'next/server';
import { createChannel, listChannels } from '../../../lib/channelManager.js';

export async function POST(request) {
  try {
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
    return NextResponse.json({ channels: await listChannels() });
  } catch (error) {
    console.error('Error listing channels:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
