/**
 * TTS Provider Router
 *
 * Priority chain: preferredProvider (per-request) → TTS_PROVIDER env → ElevenLabs → Fish → OpenAI
 *
 * IMPORTANT: Per-request provider override is done by passing `preferredProvider`
 * in the TTSRequest — NOT by mutating process.env (which is unsafe under concurrency).
 */

import type { TTSProvider, TTSProviderName, TTSRequest, TTSResponse, TTSProviderStatus } from '../types';
import { ElevenLabsProvider } from '../providers/tts/elevenlabs';
import { FishAudioProvider } from '../providers/tts/fish-audio';
import { OpenAITTSProvider } from '../providers/tts/openai';
import { CartesiaProvider } from '../providers/tts/cartesia';
import { DeepgramTTSProvider } from '../providers/tts/deepgram';

const FALLBACK_ORDER: TTSProviderName[] = ['cartesia', 'elevenlabs', 'deepgram', 'fish', 'openai'];

// Singleton provider map — instantiated once per server lifecycle
let _providers: Map<TTSProviderName, TTSProvider> | null = null;

function getProviders(): Map<TTSProviderName, TTSProvider> {
  if (!_providers) {
    _providers = new Map();
    const candidates: TTSProvider[] = [
      new CartesiaProvider(),
      new ElevenLabsProvider(),
      new DeepgramTTSProvider(),
      new FishAudioProvider(),
      new OpenAITTSProvider(),
    ];
    for (const p of candidates) {
      if (p.isAvailable()) _providers.set(p.name, p);
    }
  }
  return _providers;
}

function resolveProvider(
  providers: Map<TTSProviderName, TTSProvider>,
  preferred?: TTSProviderName
): TTSProviderName {
  // 1. Explicit per-request preference
  if (preferred && providers.has(preferred)) return preferred;

  // 2. Env var
  const envProvider = (process.env.TTS_PROVIDER ?? '').toLowerCase() as TTSProviderName;
  if (envProvider && providers.has(envProvider)) return envProvider;

  // 3. Fallback chain
  for (const name of FALLBACK_ORDER) {
    if (providers.has(name)) return name;
  }

  throw new Error(
    'No TTS provider available. Set ELEVENLABS_API_KEY, FISH_AUDIO_API_KEY, or OPENAI_API_KEY.'
  );
}

/**
 * Synthesize speech with automatic fallback.
 *
 * If `request.preferredProvider` is set, that provider is tried first.
 * On failure, falls back through the remaining available providers.
 */
export async function synthesizeSpeech(request: TTSRequest): Promise<TTSResponse> {
  const providers = getProviders();
  const primaryName = resolveProvider(providers, request.preferredProvider as TTSProviderName | undefined);
  const fallbacks = FALLBACK_ORDER.filter(
    (name) => name !== primaryName && providers.has(name)
  );
  const attemptOrder = [primaryName, ...fallbacks];

  let lastError: Error | null = null;

  for (const providerName of attemptOrder) {
    const provider = providers.get(providerName);
    if (!provider) continue;

    try {
      const result = await provider.synthesize(request);

      if (providerName !== primaryName) {
        console.warn(
          `[voice] Primary '${primaryName}' failed. Fell back to '${providerName}'. ${result.latencyMs}ms`
        );
      } else {
        console.log(`[voice/tts] ${providerName} — ${result.latencyMs}ms — ${request.text.length} chars`);
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[voice/tts] ${providerName} failed:`, lastError.message);
    }
  }

  throw lastError ?? new Error('All TTS providers failed');
}

/**
 * Synthesize speech as a stream with automatic fallback.
 * Falls back to buffered synthesis if the provider doesn't support streaming natively.
 */
export async function synthesizeSpeechStream(request: TTSRequest): Promise<import('../types').TTSStreamResponse> {
  const providers = getProviders();
  const primaryName = resolveProvider(providers, request.preferredProvider as TTSProviderName | undefined);
  const fallbacks = FALLBACK_ORDER.filter(
    (name) => name !== primaryName && providers.has(name)
  );
  const attemptOrder = [primaryName, ...fallbacks];

  let lastError: Error | null = null;

  for (const providerName of attemptOrder) {
    const provider = providers.get(providerName);
    if (!provider) continue;

    try {
      if (provider.synthesizeStream) {
        const result = await provider.synthesizeStream(request);
        if (providerName !== primaryName) {
          console.warn(`[voice] Primary '${primaryName}' failed. Fell back to streaming '${providerName}'.`);
        } else {
          console.log(`[voice/tts/stream] ${providerName} — streaming initiated`);
        }
        return result;
      } else {
        // Fallback: provider doesn't natively stream, synthesize and wrap ArrayBuffer in stream
        const result = await provider.synthesize(request);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(result.audioBuffer));
            controller.close();
          }
        });
        if (providerName !== primaryName) {
          console.warn(`[voice] Primary '${primaryName}' failed. Fell back to buffered '${providerName}'.`);
        } else {
          console.log(`[voice/tts/stream] ${providerName} — buffered fallback initiated`);
        }
        return {
          stream,
          contentType: result.contentType,
          provider: providerName,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[voice/tts/stream] ${providerName} failed:`, lastError.message);
    }
  }

  throw lastError ?? new Error('All TTS providers failed to stream');
}

export function getProviderStatus(): TTSProviderStatus {
  const providers = getProviders();
  const primary = resolveProvider(providers);
  return {
    primary,
    available: Array.from(providers.keys()),
    fallbacks: FALLBACK_ORDER.filter((n) => n !== primary && providers.has(n)),
  };
}

/** Force re-initialization (useful in tests or after env var changes) */
export function resetProviders(): void {
  _providers = null;
}
