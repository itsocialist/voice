/**
 * Next.js TTS Route Handler
 *
 * Drop into your app's app/api/tts/route.ts:
 *
 *   export { POST, GET } from '@itsocialist/voice/next/tts-handler'
 *
 * Or wrap it to add your own profile resolution:
 *
 *   import { createTTSHandler } from '@itsocialist/voice/next'
 *   import { myRegistry } from '@/lib/voice-profiles'
 *   export const { POST, GET } = createTTSHandler({ registry: myRegistry })
 */

import { synthesizeSpeech, synthesizeSpeechStream, getProviderStatus } from '../src/router/tts';
import { voiceRegistry } from '../src/profiles/registry';
import type { VoiceRegistry } from '../src/profiles/registry';
import type { TTSRouteBody, TTSProviderName } from '../src/types';

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

interface TTSHandlerOptions {
  /** Registry to use for profile lookup. Defaults to the global singleton. */
  registry?: VoiceRegistry;
}

/** True when the request opts into the streaming response path. */
function isStreamRequested(request: Request): boolean {
  const v = new URL(request.url).searchParams.get('stream');
  return v === '1' || v === 'true';
}

export function createTTSHandler(options: TTSHandlerOptions = {}) {
  const registry = options.registry ?? voiceRegistry;

  async function POST(request: Request) {
    try {
      const body: TTSRouteBody = await request.json();
      const { text, profileKey, voiceProfile: explicitProfile, provider, format } = body;

      if (!text?.trim()) {
        return new Response(JSON.stringify({ error: 'text is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Browser TTS signal — client handles synthesis locally
      if (provider === 'browser') {
        return new Response(JSON.stringify({ useBrowserTTS: true, text: text.trim() }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Resolve voice profile: explicit > registry key > registry default
      const resolvedProfile =
        explicitProfile ?? (profileKey ? registry.resolve(profileKey) : registry.getDefault());

      // Streaming path: ?stream=1 (or "true") on the request URL.
      // Returns the audio stream directly as the response body. Provider
      // metadata still surfaces via response headers.
      const wantsStream = isStreamRequested(request);

      if (wantsStream) {
        const streamResult = await synthesizeSpeechStream({
          text: text.trim(),
          voiceProfile: resolvedProfile,
          format: format ?? 'mp3',
          preferredProvider: provider as TTSProviderName | undefined,
        });
        return new Response(streamResult.toReadableStream(), {
          headers: {
            'Content-Type': streamResult.contentType,
            'Transfer-Encoding': 'chunked',
            'X-TTS-Provider': streamResult.provider,
            'X-Voice-Name': resolvedProfile.name,
            'Cache-Control': 'no-store',
          },
        });
      }

      const result = await synthesizeSpeech({
        text: text.trim(),
        voiceProfile: resolvedProfile,
        format: format ?? 'mp3',
        preferredProvider: provider as TTSProviderName | undefined,
      });

      return new Response(result.audioBuffer, {
        headers: {
          'Content-Type': result.contentType,
          'Content-Length': result.audioBuffer.byteLength.toString(),
          'X-TTS-Provider': result.provider,
          'X-TTS-Latency-Ms': result.latencyMs.toString(),
          'X-Voice-Name': resolvedProfile.name,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      console.error('[voice/tts] route error:', error);
      const message = error instanceof Error ? error.message : 'TTS failed';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async function GET() {
    // v0.3.2+: getProviderStatus is non-throwing. Always returns 200
    // even when no providers are configured (primary: null).
    const status = getProviderStatus();
    return new Response(JSON.stringify(status), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { POST, GET };
}

// Default export using global registry — zero-config drop-in
const { POST, GET } = createTTSHandler();
export { POST, GET };
