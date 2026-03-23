/**
 * Next.js STT Route Handler
 *
 * Drop into app/api/stt/route.ts:
 *   import { sttPost as POST, sttGet as GET } from '@itsocialist/voice/next'
 *   export { POST, GET }
 */

import { transcribeAudio, getSTTStatus } from '../src/router/stt';

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export function GET(): Response {
  return json(getSTTStatus());
}

export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get('content-type') ?? 'audio/webm';
    const audioBuffer = await request.arrayBuffer();

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return json({ error: 'No audio data provided' }, { status: 400 });
    }

    const result = await transcribeAudio({ audioBuffer, contentType, language: 'en' });

    return json({
      transcript: result.transcript,
      confidence: result.confidence,
      provider: result.provider,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    console.error('[voice/stt] route error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      { status: 500 }
    );
  }
}
