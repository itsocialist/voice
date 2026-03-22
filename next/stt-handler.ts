/**
 * Next.js STT Route Handler
 *
 * Drop into app/api/stt/route.ts:
 *   export { POST, GET } from '@briandawson/voice/next/stt-handler'
 */

import { NextResponse } from 'next/server';
import { transcribeAudio, getSTTStatus } from '../src/router/stt';

export async function GET() {
  return NextResponse.json(getSTTStatus());
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? 'audio/webm';
    const audioBuffer = await request.arrayBuffer();

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'No audio data provided' }, { status: 400 });
    }

    const result = await transcribeAudio({ audioBuffer, contentType, language: 'en' });

    return NextResponse.json({
      transcript: result.transcript,
      confidence: result.confidence,
      provider: result.provider,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    console.error('[voice/stt] route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      { status: 500 }
    );
  }
}
