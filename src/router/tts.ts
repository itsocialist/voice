/**
 * TTS Provider Router
 *
 * Priority chain: preferredProvider (per-request) → TTS_PROVIDER env → ElevenLabs → Fish → OpenAI
 *
 * IMPORTANT: Per-request provider override is done by passing `preferredProvider`
 * in the TTSRequest — NOT by mutating process.env (which is unsafe under concurrency).
 */

import type { TTSProvider, TTSProviderName, TTSRequest, TTSResponse, TTSProviderStatus, TTSStreamResponse } from '../types';
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

/**
 * Pick the primary provider given env + per-request preference. Returns
 * null when no provider is available — callers decide how to handle that
 * (synthesizeSpeech throws; getProviderStatus reports the null).
 */
function resolveProvider(
  providers: Map<TTSProviderName, TTSProvider>,
  preferred?: TTSProviderName,
): TTSProviderName | null {
  // 1. Explicit per-request preference
  if (preferred && providers.has(preferred)) return preferred;

  // 2. Env var
  const envProvider = (process.env.TTS_PROVIDER ?? '').toLowerCase() as TTSProviderName;
  if (envProvider && providers.has(envProvider)) return envProvider;

  // 3. Fallback chain
  for (const name of FALLBACK_ORDER) {
    if (providers.has(name)) return name;
  }

  return null;
}

function noProvidersError(): Error {
  return new Error(
    'No TTS provider available. Set ELEVENLABS_API_KEY, CARTESIA_API_KEY, ' +
    'DEEPGRAM_API_KEY, FISH_AUDIO_API_KEY, or OPENAI_API_KEY.',
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
  if (!primaryName) throw noProvidersError();
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
/**
 * Synthesize speech as a stream with automatic fallback.
 *
 * Behaviour in v0.3.2:
 * - Providers with `supportsStreaming: true` AND a `synthesizeStream`
 *   method are used for true incremental delivery. ElevenLabs is the
 *   only such provider today.
 * - Other providers fall back to wrapping their `synthesize()` output
 *   in a single-chunk ReadableStream. The router emits a loud warning
 *   when this happens — the consumer asked to stream but the chosen
 *   provider can't, so they should know.
 * - Use `getProviderStatus().available` to check which providers are
 *   configured up front if you need to gate streaming on real support.
 */
export async function synthesizeSpeechStream(request: TTSRequest): Promise<TTSStreamResponse> {
  const providers = getProviders();
  const primaryName = resolveProvider(providers, request.preferredProvider as TTSProviderName | undefined);
  if (!primaryName) throw noProvidersError();
  const fallbacks = FALLBACK_ORDER.filter(
    (name) => name !== primaryName && providers.has(name)
  );
  const attemptOrder = [primaryName, ...fallbacks];

  let lastError: Error | null = null;

  for (const providerName of attemptOrder) {
    const provider = providers.get(providerName);
    if (!provider) continue;

    try {
      const hasRealStream = provider.synthesizeStream && provider.supportsStreaming === true;
      if (hasRealStream && provider.synthesizeStream) {
        const result = await provider.synthesizeStream(request);
        if (providerName !== primaryName) {
          console.warn(`[voice/tts/stream] Primary '${primaryName}' failed. Fell back to streaming '${providerName}'.`);
        } else {
          console.log(`[voice/tts/stream] ${providerName} — streaming initiated`);
        }
        return result;
      }

      // Buffered fallback: this provider doesn't actually stream. We honour
      // the caller's synthesizeSpeechStream() request by wrapping synthesize()
      // output in a one-chunk ReadableStream, but we warn loudly so they
      // know they're not getting real incremental delivery. Same fallback
      // behaviour as v0.2.x but with honest logging.
      const result = await provider.synthesize(request);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(result.audioBuffer));
          controller.close();
        },
      });
      console.warn(
        `[voice/tts/stream] '${providerName}' does not support real streaming — ` +
        `wrapping buffered synthesize() output in a one-chunk stream. ` +
        `For sub-second TTFA, route to a provider with supportsStreaming: true (e.g. ElevenLabs).`,
      );
      return makeStreamResponse(stream, result.contentType, providerName);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[voice/tts/stream] ${providerName} failed:`, lastError.message);
    }
  }

  throw lastError ?? new Error('All TTS providers failed to stream');
}

/**
 * Build a TTSStreamResponse from a ReadableStream — exposes both the
 * canonical `chunks` (AsyncIterable) and `toReadableStream()` shape plus
 * the legacy `stream` field for back-compat.
 */
function makeStreamResponse(
  stream: ReadableStream<Uint8Array>,
  contentType: string,
  provider: TTSProviderName,
): TTSStreamResponse {
  return {
    chunks: stream as unknown as AsyncIterable<Uint8Array>,
    contentType,
    provider,
    toReadableStream: () => stream,
    stream,
  };
}

/**
 * Returns provider availability without throwing. `primary` is `null` when
 * no provider is configured (v0.3.2 behaviour change — v0.2.x threw).
 * Safe to call as a health check from any route.
 */
export function getProviderStatus(): TTSProviderStatus {
  const providers = getProviders();
  const primary = resolveProvider(providers);
  return {
    primary,
    available: Array.from(providers.keys()),
    fallbacks: primary
      ? FALLBACK_ORDER.filter((n) => n !== primary && providers.has(n))
      : [],
  };
}

/** Force re-initialization (useful in tests or after env var changes) */
export function resetProviders(): void {
  _providers = null;
}
