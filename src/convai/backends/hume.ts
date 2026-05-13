/**
 * Hume EVI 3 ConvAI backend (v0.4.0).
 *
 * Empathic Voice Interface 3 — the empathy-axis backend. Strongest fit for
 * use cases where the agent needs to convey real emotional expression
 * (sales-sim "buyer persona conveys frustration / skepticism / surprise").
 *
 * Architecture notes (differs from ElevenLabs):
 *
 * - **Auth**: API key for REST (`X-Hume-Api-Key`); for WebSocket connections
 *   the client needs a short-lived (~30min) access token minted server-side
 *   from API key + Secret key via `POST /oauth2-cc/token`.
 *
 * - **Connection**: WebSocket direct at `wss://api.hume.ai/v0/evi`. There is
 *   no signed-URL handshake step. The wss URL with `?access_token=...&config_id=...`
 *   IS the credential — voice-lib returns it as `SessionHandle.signedUrl`.
 *
 * - **Persistent agent = Config**: created via `POST /v0/evi/configs`. Configs
 *   are versioned; the version goes on the WS connect as `?config_version=...`.
 *
 * - **Session resume = chat groups**: server emits `chat_group_id` in the
 *   `chat_metadata` message on first connect. Consumer must capture and
 *   pass it back via `resumeSession({ ...handle, _ctx: { chatGroupId } })`.
 *
 * - **No `first_message` field**: maps to `event_messages.on_new_chat.text`.
 *
 * - **No per-session emotion-direction knob**: `tts.suggestedAudioTags` is
 *   ignored on Hume. Emotion expression lives in the saved voice's
 *   `description` (custom voices) or the system prompt itself.
 *
 * - **Concurrent connection cap is low** (1 free / 5 starter / 10 pro / 20
 *   scale). Hitting it returns HTTP 429 on token mint; surfaced as
 *   `ConvAIError { type: 'rate_limit', retryable: true }`.
 */

import { ConvAIError } from '../client';
import type {
  ConvAIBackend,
  ConvAISessionHandle,
  ConvAISessionStartOpts,
} from '../backend';
import type { ConvAIAgentConfig, ConvAILLMConfig } from '../../types';

const HUME_API = 'https://api.hume.ai';

export interface HumeBackendOptions {
  /** API key. Defaults to `process.env.HUME_API_KEY`. */
  apiKey?: string;
  /**
   * Secret key — needed only when minting OAuth access tokens for
   * client-side WebSocket connections. Defaults to `process.env.HUME_SECRET_KEY`.
   * For server-side-only use you can omit this; voice-lib will fall back to
   * sending the raw API key in the wss URL (Hume permits that for server use).
   */
  secretKey?: string;
  /** API base URL override (for testing). Defaults to `https://api.hume.ai`. */
  apiBaseUrl?: string;
  /**
   * Whether to mint a short-lived OAuth access token for the wss URL
   * (recommended for browser clients), or pass the raw API key in the URL
   * (server-side only). Defaults to `true` when `secretKey` is available.
   */
  useAccessToken?: boolean;
}

/**
 * Hume-specific bag of state carried inside `SessionHandle._ctx`. Treated
 * as opaque by external consumers; the Hume backend reads/writes it.
 */
interface HumeSessionContext {
  /** Whether the config was created by this session (and should be deleted on end). */
  ephemeral: boolean;
  /** Hume Config version this session is using. */
  configVersion?: number;
  /** Server-issued chat-group ID for resume (set by consumer after first message). */
  chatGroupId?: string;
  /** UNIX ms when the access token expires; null when using raw API key. */
  accessTokenExpiresAt: number | null;
}

/**
 * Map our `ConvAILLMConfig.model` string to Hume's `language_model.model_provider`.
 * Hume requires both `model_provider` (vendor enum) and `model_resource` (the
 * exact model identifier). We infer the provider from common model-name prefixes.
 */
function inferModelProvider(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) return 'OPEN_AI';
  if (m.startsWith('claude-')) return 'ANTHROPIC';
  if (m.startsWith('gemini-')) return 'GOOGLE';
  if (m.startsWith('llama-') || m.includes('mixtral')) return 'GROQ';
  if (m.startsWith('cmd-r') || m.startsWith('command-')) return 'GROQ';
  if (m.startsWith('grok-')) return 'X_AI';
  // Fallback: assume the consumer is responsible for setting the right value
  // out-of-band. Hume will error if invalid; we surface that as upstream_invalid.
  return 'CUSTOM_LANGUAGE_MODEL';
}

function buildLanguageModelPayload(llm?: ConvAILLMConfig) {
  if (!llm?.model) return undefined;
  return {
    model_provider: inferModelProvider(llm.model),
    model_resource: llm.model,
    ...(llm.temperature !== undefined && { temperature: llm.temperature }),
  };
}

/**
 * Map `ConvAIAgentConfig` to Hume's config-create payload. See:
 * https://dev.hume.ai/reference/speech-to-speech-evi/configs/create-config
 */
function buildConfigPayload(config: ConvAIAgentConfig) {
  const voiceId = config.agent.voiceId;
  const payload: Record<string, unknown> = {
    name: config.agent.agentName,
    prompt: { text: config.agent.systemPrompt },
    // Hume requires a voice on EVI configs. Treat the caller's voiceId as a
    // HUME_AI provider voice name; for custom voices (Octave-cloned), the
    // caller should pass the UUID — we still send as `name` since Hume's
    // discriminator field is provider, not field-name.
    voice: { provider: 'HUME_AI' as const, name: voiceId },
    // Hume has no `first_message` field; closest analogue is the
    // on_new_chat event message hook.
    event_messages: {
      on_new_chat: { enabled: true, text: config.agent.firstMessage },
    },
  };

  const lm = buildLanguageModelPayload(config.llm);
  if (lm) payload.language_model = lm;

  // Session policy → event-message hooks (Hume's nearest equivalent)
  if (config.session?.maxDurationSeconds !== undefined) {
    (payload.event_messages as Record<string, unknown>).on_max_duration_timeout = {
      enabled: true,
      text: '',
    };
  }

  // tts.suggestedAudioTags / expressiveMode have no Hume equivalent — silently
  // ignored. Emotion direction in Hume comes from the voice's description
  // and the system prompt, not a per-turn field.

  return payload;
}

async function mintAccessToken(
  apiKey: string,
  secretKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<{ token: string; expiresAtMs: number }> {
  const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const res = await fetch(`${baseUrl}/oauth2-cc/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const type =
      res.status === 401 || res.status === 403 ? 'auth'
        : res.status === 429 ? 'rate_limit'
          : res.status >= 500 ? 'upstream_unavailable'
            : 'upstream_invalid';
    throw new ConvAIError({
      code: res.status === 429 ? 'HUME_CONCURRENT_LIMIT' : 'HUME_AUTH_FAILED',
      type,
      provider: 'hume',
      message: `Hume access-token mint failed (${res.status}): ${body}`,
      status: res.status,
      retryable: type === 'rate_limit' || type === 'upstream_unavailable',
    });
  }
  const data = await res.json();
  const ttlMs = ((data.expires_in as number) ?? 1800) * 1000;
  return { token: data.access_token as string, expiresAtMs: Date.now() + ttlMs };
}

async function createConfig(
  apiKey: string,
  baseUrl: string,
  config: ConvAIAgentConfig,
  timeoutMs: number,
): Promise<{ id: string; version: number }> {
  const res = await fetch(`${baseUrl}/v0/evi/configs`, {
    method: 'POST',
    headers: {
      'X-Hume-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildConfigPayload(config)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ConvAIError({
      code: 'HUME_CONFIG_CREATE_FAILED',
      type: res.status >= 500 ? 'upstream_unavailable' : 'upstream_invalid',
      provider: 'hume',
      message: `Hume config creation failed (${res.status}): ${body}`,
      status: res.status,
      retryable: res.status >= 500,
    });
  }
  const data = await res.json();
  return { id: data.id as string, version: (data.version as number) ?? 0 };
}

async function deleteConfig(
  apiKey: string,
  baseUrl: string,
  configId: string,
): Promise<void> {
  // Hume docs are ambiguous on whether DELETE /v0/evi/configs/{id} exists.
  // Best-effort: try it, tolerate any non-2xx silently.
  await fetch(`${baseUrl}/v0/evi/configs/${configId}`, {
    method: 'DELETE',
    headers: { 'X-Hume-Api-Key': apiKey },
  }).catch(() => {});
}

function buildWssUrl(opts: {
  baseUrl: string;
  apiKey: string;
  accessToken?: string;
  configId: string;
  configVersion?: number;
  resumedChatGroupId?: string;
}): string {
  // wss://api.hume.ai/v0/evi → strip https/http prefix from baseUrl
  const wsBase = opts.baseUrl.replace(/^https?/, 'wss');
  const params = new URLSearchParams();
  if (opts.accessToken) params.set('access_token', opts.accessToken);
  else params.set('api_key', opts.apiKey);
  params.set('config_id', opts.configId);
  if (opts.configVersion !== undefined) params.set('config_version', String(opts.configVersion));
  if (opts.resumedChatGroupId) params.set('resumed_chat_group_id', opts.resumedChatGroupId);
  return `${wsBase}/v0/evi?${params.toString()}`;
}

/**
 * Construct a Hume EVI 3 ConvAI backend.
 *
 *   import { createConvAI, hume } from '@itsocialist/voice';
 *
 *   const convai = createConvAI({
 *     backend: hume({ apiKey: process.env.HUME_API_KEY, secretKey: process.env.HUME_SECRET_KEY }),
 *   });
 *
 *   const handle = await convai.startSession({
 *     config: {
 *       agent: { systemPrompt, firstMessage, voiceId: 'ITO', agentName: 'Coach' },
 *       llm: { model: 'claude-sonnet-4', temperature: 0.7 },
 *     },
 *   });
 *
 *   // handle.signedUrl is the wss:// URL to connect to.
 *
 * For session resume — after capturing `chat_group_id` from the server's
 * first `chat_metadata` message in your WS client, store it on the handle
 * and call `convai.resumeSession({ ...handle, _ctx: { chatGroupId } })` to
 * get fresh credentials for reconnection.
 */
export function hume(options: HumeBackendOptions = {}): ConvAIBackend {
  const apiKey = options.apiKey;
  const secretKey = options.secretKey;
  const baseUrl = options.apiBaseUrl ?? HUME_API;
  // Default to OAuth access tokens when a secret key is available (browser-safe).
  const useAccessToken = options.useAccessToken ?? (secretKey !== undefined || process.env.HUME_SECRET_KEY !== undefined);

  function resolveKey(): string {
    const k = apiKey ?? process.env.HUME_API_KEY;
    if (!k) {
      throw new ConvAIError({
        code: 'API_KEY_MISSING',
        type: 'auth',
        provider: 'hume',
        message: 'HUME_API_KEY is required',
        retryable: false,
      });
    }
    return k;
  }

  function resolveSecret(): string | undefined {
    return secretKey ?? process.env.HUME_SECRET_KEY;
  }

  return {
    id: 'hume',

    async startSession(opts: ConvAISessionStartOpts): Promise<ConvAISessionHandle> {
      const key = resolveKey();
      const timeoutMs = opts.config?.session?.timeoutMs ?? 15000;

      let configId: string;
      let configVersion: number | undefined;
      let ephemeral = false;

      if (opts.config && !opts.agentId) {
        // Ephemeral: create a Hume config on the fly, delete it on endSession.
        const created = await createConfig(key, baseUrl, opts.config, timeoutMs);
        configId = created.id;
        configVersion = created.version;
        ephemeral = true;
      } else if (opts.agentId) {
        configId = opts.agentId;
        // Caller can pass config_version via the _ctx field on a prior handle
        // we returned — but the public ConvAISessionStartOpts doesn't surface
        // it, so default to the latest version.
        configVersion = undefined;
        if (opts.overrides) {
          // Hume supports per-session overrides via `session_settings` either
          // as a query param or the first WS message. In v0.4.0 we don't
          // encode them — that needs runtime escape since Hume's session
          // settings schema is rich. Document the limit honestly.
          throw new ConvAIError({
            code: 'OVERRIDES_NOT_SUPPORTED_V040',
            type: 'config_invalid',
            provider: 'hume',
            message:
              'Hume per-session overrides are deferred to v0.4.1. For now, create a new Hume config ' +
              'with the desired settings and pass its config_id as agentId.',
            retryable: false,
          });
        }
      } else {
        throw new ConvAIError({
          code: 'CONFIG_INVALID',
          type: 'config_invalid',
          provider: 'hume',
          message: 'startSession requires either { config } for ephemeral agents OR { agentId } for existing configs.',
          retryable: false,
        });
      }

      let accessToken: string | undefined;
      let accessTokenExpiresAt: number | null = null;
      if (useAccessToken) {
        const sec = resolveSecret();
        if (!sec) {
          throw new ConvAIError({
            code: 'SECRET_KEY_MISSING',
            type: 'auth',
            provider: 'hume',
            message:
              'HUME_SECRET_KEY is required when useAccessToken is true (default for browser clients). ' +
              'Set the env var, pass secretKey to hume({}), or set useAccessToken: false for server-only use.',
            retryable: false,
          });
        }
        const minted = await mintAccessToken(key, sec, baseUrl, timeoutMs);
        accessToken = minted.token;
        accessTokenExpiresAt = minted.expiresAtMs;
      }

      const wssUrl = buildWssUrl({
        baseUrl,
        apiKey: key,
        accessToken,
        configId,
        configVersion,
      });

      const ctx: HumeSessionContext = {
        ephemeral,
        configVersion,
        accessTokenExpiresAt,
      };

      return {
        backend: 'hume',
        agentId: configId,
        signedUrl: wssUrl,
        _ctx: ctx,
      };
    },

    async resumeSession(handle: ConvAISessionHandle): Promise<ConvAISessionHandle> {
      const key = resolveKey();
      const timeoutMs = 15000;
      const ctx = (handle._ctx ?? {}) as HumeSessionContext;

      let accessToken: string | undefined;
      let accessTokenExpiresAt: number | null = null;
      if (useAccessToken) {
        const sec = resolveSecret();
        if (!sec) {
          throw new ConvAIError({
            code: 'SECRET_KEY_MISSING',
            type: 'auth',
            provider: 'hume',
            message: 'HUME_SECRET_KEY required to mint access token for resume.',
            retryable: false,
          });
        }
        const minted = await mintAccessToken(key, sec, baseUrl, timeoutMs);
        accessToken = minted.token;
        accessTokenExpiresAt = minted.expiresAtMs;
      }

      const wssUrl = buildWssUrl({
        baseUrl,
        apiKey: key,
        accessToken,
        configId: handle.agentId,
        configVersion: ctx.configVersion,
        resumedChatGroupId: ctx.chatGroupId,
      });

      return {
        backend: 'hume',
        agentId: handle.agentId,
        signedUrl: wssUrl,
        _ctx: { ...ctx, accessTokenExpiresAt },
      };
    },

    async endSession(handle: ConvAISessionHandle): Promise<void> {
      const ctx = (handle._ctx ?? {}) as HumeSessionContext;
      if (ctx.ephemeral) {
        const key = resolveKey();
        await deleteConfig(key, baseUrl, handle.agentId);
      }
      // Universal-config sessions: caller-managed. No-op.
    },
  };
}
