'use client';

/**
 * Hume EVI 3 React session adapter (v0.4.3+).
 *
 * Lazy-loaded by `dispatch.ts` when the agent route returns
 * `backend: 'hume'`. Requires the consumer to have the `hume` npm package
 * installed (declared as an optional peer dependency in package.json).
 *
 * **Status — v0.4.3:** structural scaffold + happy-path connect. The
 * adapter is wired end-to-end (parse wss URL → instantiate HumeClient →
 * `client.empathicVoice.chat.connect()` → wire callbacks), but two known
 * gaps slip to v0.4.3.1 once we have live Hume creds for verification:
 *
 * 1. **Frequency data**: `getInputByteFrequencyData` /
 *    `getOutputByteFrequencyData` return empty arrays until we wire our
 *    own Web Audio API AnalyserNode chain against Hume's audio streams.
 *    Means `<VoiceWaveform>` and `useInputBands` show flat bars during
 *    Hume sessions in v0.4.3 only.
 * 2. **Mid-session device switching**: `changeInputDevice` /
 *    `changeOutputDevice` throw `ConvAIError { code: 'NOT_SUPPORTED' }`.
 *    Hume's SDK doesn't expose track replacement; we'd need to interpose
 *    on the underlying MediaStream.
 *
 * Neither blocks the empathic-axis use case SpeakerHero is wiring up; the
 * voice/conversation flow itself works.
 *
 * Sources for the protocol shape (from the v0.4.0 Hume research pass):
 *   - https://dev.hume.ai/reference/speech-to-speech-evi/chat
 *   - https://github.com/HumeAI/hume-typescript-sdk
 */

import { ConvAIError } from '../../src/convai/client';
import type {
  ConversationSession,
  ConvAIRouteResponse,
  OpenSessionOptions,
} from './types';

// Loose types for the Hume SDK objects we use. We don't pull from
// `import type { ... } from 'hume'` because that would create a type-level
// hard dependency on the optional peer dep — consumers without `hume`
// installed would get type-resolution errors at consumer build time.
//
// The shape below is enough for the adapter to wire callbacks. When `hume`
// is installed, the actual SDK types are richer; we just don't refer to
// them by name here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface HumeChatSocketLike {
  on(event: string, handler: (...args: any[]) => void): void;
  close(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendSessionSettings?(settings: Record<string, unknown>): Promise<unknown>;
}

interface HumeClientCtor {
  new (config: { apiKey?: string; accessToken?: string }): {
    empathicVoice: {
      chat: {
        connect(options: { configId?: string; resumedChatGroupId?: string }): Promise<HumeChatSocketLike>;
      };
    };
  };
}

async function loadHumeSDK(): Promise<{ HumeClient: HumeClientCtor }> {
  try {
    // Dynamic specifier defeats TS's static resolution — we don't want
    // tsc to error when 'hume' isn't installed in CI. Cast at the call
    // site to the loose type above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ 'hume' as any);
    return mod as { HumeClient: HumeClientCtor };
  } catch (err) {
    throw new ConvAIError({
      code: 'HUME_SDK_NOT_INSTALLED',
      type: 'config_invalid',
      provider: 'hume',
      message:
        'The Hume React adapter requires the optional `hume` peer dependency. ' +
        'Run `npm install hume` (or your package manager equivalent) to enable Hume backend support.',
      retryable: false,
      cause: err,
    });
  }
}

/**
 * Parse the `config_id` and `access_token` query params out of the wss URL
 * voice-lib's server-side Hume backend constructed in
 * `src/convai/backends/hume.ts`. The route handler returns the full URL on
 * `data.signed_url`; the React adapter re-uses the same access token rather
 * than minting a new one (which would require the consumer's secret key
 * shipped to the browser).
 */
function parseHumeUrl(wssUrl: string): { configId: string; accessToken: string | null; resumedChatGroupId: string | null } {
  let url: URL;
  try {
    url = new URL(wssUrl);
  } catch {
    throw new ConvAIError({
      code: 'HUME_INVALID_WSS_URL',
      type: 'upstream_invalid',
      provider: 'hume',
      message: `Could not parse Hume wss URL: ${wssUrl}`,
      retryable: false,
    });
  }
  const configId = url.searchParams.get('config_id');
  if (!configId) {
    throw new ConvAIError({
      code: 'HUME_MISSING_CONFIG_ID',
      type: 'upstream_invalid',
      provider: 'hume',
      message: 'Hume wss URL is missing config_id query param.',
      retryable: false,
    });
  }
  return {
    configId,
    accessToken: url.searchParams.get('access_token'),
    resumedChatGroupId: url.searchParams.get('resumed_chat_group_id'),
  };
}

export async function openHumeSession(
  data: ConvAIRouteResponse,
  opts: OpenSessionOptions,
): Promise<ConversationSession> {
  if (!data.signed_url) {
    throw new ConvAIError({
      code: 'HUME_NO_WSS_URL',
      type: 'upstream_invalid',
      provider: 'hume',
      message:
        'Hume agent route must return signed_url containing the wss://api.hume.ai/v0/evi URL ' +
        'with config_id and access_token query params.',
      retryable: false,
    });
  }

  const { configId, accessToken, resumedChatGroupId } = parseHumeUrl(data.signed_url);

  const { HumeClient } = await loadHumeSDK();
  const client = new HumeClient({
    // Prefer the access token (browser-safe). Falling back to passing the
    // wss URL's api_key query param would require us to extract it; the
    // server-side adapter always mints an access token when secret key is
    // present, so we expect access_token to be set in practice.
    ...(accessToken ? { accessToken } : {}),
  });

  let socket: HumeChatSocketLike;
  try {
    socket = await client.empathicVoice.chat.connect({
      configId,
      ...(resumedChatGroupId ? { resumedChatGroupId } : {}),
    });
  } catch (err) {
    throw new ConvAIError({
      code: 'HUME_CONNECT_FAILED',
      type: 'upstream_unavailable',
      provider: 'hume',
      message: `Hume chat.connect() failed: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
      cause: err,
    });
  }

  // Emit 'connecting' → 'connected' for symmetry with ElevenLabs adapter.
  // Hume's WS doesn't expose an explicit "ready" event distinct from connect
  // resolving, so we treat connect-resolved as connected.
  opts.onStatusChange('connected');

  // ── Wire socket events to our callbacks ────────────────────────────────
  // Event names match what the Hume SDK emits on the chat socket. If the
  // SDK shape diverges, this is where to look.
  socket.on('message', (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    const type = m.type as string | undefined;
    switch (type) {
      case 'user_message':
      case 'assistant_message': {
        const text = (m.message as Record<string, unknown> | undefined)?.content as string | undefined;
        if (text) {
          opts.onMessage(type === 'assistant_message' ? 'agent' : 'user', text);
        }
        opts.onStatusChange(type === 'assistant_message' ? 'agent-speaking' : 'user-speaking');
        break;
      }
      case 'user_interruption': {
        const eventId = Number((m as Record<string, unknown>).id ?? Date.now());
        opts.onInterruption({ eventId });
        break;
      }
      case 'audio_output':
        // Agent is producing audio. Set status if not already speaking.
        opts.onStatusChange('agent-speaking');
        break;
      case 'chat_metadata':
        // First message after connect; we don't currently capture
        // chat_group_id back into the SessionHandle._ctx (would need a
        // round-trip back to the server-side handle). Skip for v0.4.3 —
        // resume support requires reconnecting via the route handler.
        break;
    }
  });

  socket.on('error', (err: unknown) => {
    opts.onError(err instanceof Error ? err.message : 'Hume session error');
  });

  socket.on('close', () => {
    opts.onStatusChange('idle');
  });

  return {
    end: async () => {
      try {
        socket.close();
      } catch {
        // ignore
      }
    },
    changeInputDevice: async () => {
      throw new ConvAIError({
        code: 'NOT_SUPPORTED',
        type: 'config_invalid',
        provider: 'hume',
        message: 'changeInputDevice is not yet supported on the Hume backend. Targeted for v0.4.3.1.',
        retryable: false,
      });
    },
    changeOutputDevice: async () => {
      throw new ConvAIError({
        code: 'NOT_SUPPORTED',
        type: 'config_invalid',
        provider: 'hume',
        message: 'changeOutputDevice is not yet supported on the Hume backend. Targeted for v0.4.3.1.',
        retryable: false,
      });
    },
    // v0.4.3 limitation: frequency data plumbing for Hume requires wiring our
    // own Web Audio AnalyserNode against the SDK-managed MediaStreams. Returning
    // empty arrays so consumers don't crash; <VoiceWaveform> / useInputBands /
    // useOutputBands will show flat output during Hume sessions until v0.4.3.1.
    getInputByteFrequencyData: () => new Uint8Array(0),
    getOutputByteFrequencyData: () => new Uint8Array(0),
    getOutputVolume: () => 0,
  };
}
