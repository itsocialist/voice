/**
 * Next.js TTS Route Handler
 *
 * Drop into your app's app/api/tts/route.ts:
 *
 *   export { POST, GET } from '@briandawson/voice/next/tts-handler'
 *
 * Or wrap it to add your own profile resolution:
 *
 *   import { createTTSHandler } from '@briandawson/voice/next'
 *   import { myRegistry } from '@/lib/voice-profiles'
 *   export const { POST, GET } = createTTSHandler({ registry: myRegistry })
 */

import type { NextRequest } from 'next/server';
import { synthesizeSpeech, getProviderStatus } from '../src/router/tts';
import { voiceRegistry } from '../src/profiles/registry';
import type { VoiceRegistry } from '../src/profiles/registry';
import type { TTSRouteBody, TTSProviderName } from '../src/types';

interface TTSHandlerOptions {
  /** Registry to use for profile lookup. Defaults to the global singleton. */
  registry?: VoiceRegistry;
}

export function createTTSHandler(options: TTSHandlerOptions = {}) {
  const registry = options.registry ?? voiceRegistry;

  async function POST(request: NextRequest) {
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
    try {
      const status = getProviderStatus();
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get status';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return { POST, GET };
}

// Default export using global registry — zero-config drop-in
const { POST, GET } = createTTSHandler();
export { POST, GET };
