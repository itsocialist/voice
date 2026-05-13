/**
 * ElevenLabs ConvAI — Server-side client
 *
 * Creates and manages ephemeral ConvAI agents.
 * Returns both signed_url (legacy WebSocket) and conversation_token (WebRTC)
 * so consuming apps can choose whichever the ElevenLabs SDK version expects.
 *
 * v0.3.1 introduced:
 * - Nested config shape (ConvAIAgentConfigNested) as the canonical layout.
 *   Flat v0.2.x shape still accepted with a one-time deprecation warning.
 * - camelCase `silenceDurationMs` on ConvAITurnDetection. Snake-case
 *   `silence_duration_ms` still accepted with a one-time deprecation warning.
 * - Richer ConvAIError fields: { type, provider, retryable, retryAfterMs, cause }.
 *   Legacy `code` values preserved for backward compat. The `type` field is
 *   the new canonical axis for retry-routing across providers.
 */

import type {
  ConvAIAgentConfig,
  ConvAIAgentConfigNested,
  ConvAIAgentResult,
  ConvAILLMConfig,
  ConvAISessionOverrides,
  ConvAISessionOverridesNested,
  ConvAITurnDetection,
} from '../types';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// ── Typed error ───────────────────────────────────────────────────────────────

/**
 * Error category for retry/routing decisions. Provider-neutral so the same
 * taxonomy applies when Hume / Cartesia Line / OpenAI Realtime backends are
 * added in v0.4+.
 */
export type ConvAIErrorType =
  | 'auth'                    // API key missing/invalid
  | 'rate_limit'              // hit upstream rate limit (retryable with backoff)
  | 'upstream_unavailable'    // 5xx, transient (retryable)
  | 'upstream_invalid'        // 4xx other than 401/429 (not retryable as-is)
  | 'config_invalid'          // bad arguments from caller
  | 'session_expired'         // signed URL or token expired
  | 'timeout';                // request exceeded timeoutMs

/**
 * Provider identifier for multi-backend dispatch.
 *
 * v0.3.x ships only the `'elevenlabs'` implementation. The other values
 * are forward-looking — they reserve the type-system slots for the
 * `ConvAIBackend` implementations targeted at v0.4+:
 *
 *   - `'hume'` — Hume EVI 3 / Octave. Anchor backend for v0.4.0
 *     (empathic axis: best emotion expression in blind tests,
 *     <300ms voice-to-voice). Strongest fit for sales-sim use cases.
 *   - `'cartesia-line'` — Cartesia Line. v0.5.0 candidate. Latency
 *     winner (Sonic-3.5 ~40-90ms TTFA, Line $0.06/min flat).
 *   - `'openai-realtime'` — OpenAI Realtime API (gpt-realtime).
 *     v0.5.0 candidate. Speech-to-speech single model + native MCP.
 *
 * Type widening done in v0.3.4 to telegraph the trajectory; no runtime
 * implementation exists for these values yet. Calling
 * `createConvAI({ backend: hume({...}) })` won't work until v0.4.
 */
export type ConvAIProviderId = 'elevenlabs' | 'hume' | 'cartesia-line' | 'openai-realtime';

/** Legacy code values from v0.2.x — preserved for backward compat. */
export type ConvAILegacyCode =
  | 'API_KEY_MISSING'
  | 'AGENT_CREATION_FAILED'
  | 'SIGNED_URL_FAILED'
  | 'ELEVENLABS_UNAVAILABLE'
  | 'OVERRIDE_FAILED';

interface LegacyCodeMeta {
  type: ConvAIErrorType;
  retryable: boolean;
}

const LEGACY_CODE_META: Record<ConvAILegacyCode, LegacyCodeMeta> = {
  API_KEY_MISSING: { type: 'auth', retryable: false },
  AGENT_CREATION_FAILED: { type: 'upstream_invalid', retryable: false },
  SIGNED_URL_FAILED: { type: 'upstream_invalid', retryable: false },
  ELEVENLABS_UNAVAILABLE: { type: 'upstream_unavailable', retryable: true },
  OVERRIDE_FAILED: { type: 'upstream_invalid', retryable: false },
};

export interface ConvAIErrorDetails {
  code: string;
  message: string;
  type: ConvAIErrorType;
  provider?: ConvAIProviderId;
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

/**
 * Typed error thrown by every ConvAI client function.
 *
 * Backward-compatible constructor: existing call sites using the v0.2.x
 * positional form `new ConvAIError(code, message, status?)` continue to work.
 * New call sites should use the `ConvAIErrorDetails` options form which
 * carries `type`, `retryable`, `retryAfterMs`, and `cause`.
 *
 * Reading the result:
 * - `err.code` — legacy string code (e.g. `'ELEVENLABS_UNAVAILABLE'`). Stable.
 * - `err.type` — provider-neutral category (e.g. `'upstream_unavailable'`).
 *   Use this for retry/routing logic instead of `err.code`.
 * - `err.retryable` — explicit retry hint.
 * - `err.retryAfterMs` — set when upstream returned a Retry-After header.
 */
export class ConvAIError extends Error {
  readonly name = 'ConvAIError';
  readonly code: string;
  readonly type: ConvAIErrorType;
  readonly provider: ConvAIProviderId;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  // `cause` is on the standard Error type since ES2022; declared here for
  // explicit visibility in the public surface.
  declare readonly cause?: unknown;

  constructor(
    codeOrDetails: ConvAILegacyCode | string | ConvAIErrorDetails,
    message?: string,
    status?: number,
  ) {
    // Legacy positional form: new ConvAIError(code, message, status?)
    if (typeof codeOrDetails === 'string') {
      super(message ?? codeOrDetails);
      this.code = codeOrDetails;
      this.status = status;
      const meta = LEGACY_CODE_META[codeOrDetails as ConvAILegacyCode]
        ?? { type: 'upstream_invalid', retryable: false };
      this.type = meta.type;
      this.retryable = meta.retryable;
      this.provider = 'elevenlabs';
      return;
    }

    // New options form
    super(codeOrDetails.message, codeOrDetails.cause !== undefined ? { cause: codeOrDetails.cause } : undefined);
    this.code = codeOrDetails.code;
    this.type = codeOrDetails.type;
    this.provider = codeOrDetails.provider ?? 'elevenlabs';
    this.status = codeOrDetails.status;
    this.retryable = codeOrDetails.retryable ?? false;
    this.retryAfterMs = codeOrDetails.retryAfterMs;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function signal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function resolveKey(apiKey?: string): string {
  const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ConvAIError('API_KEY_MISSING', 'ELEVENLABS_API_KEY is required');
  return key;
}

/**
 * Map an upstream Fetch response to a ConvAIError. Reads Retry-After when
 * present (used by 429 rate-limit responses).
 */
async function errorFromResponse(
  res: Response,
  legacyCode: ConvAILegacyCode,
  contextMessage: string,
): Promise<ConvAIError> {
  const body = await res.text().catch(() => '');
  let type: ConvAIErrorType;
  let retryable = false;
  if (res.status === 401 || res.status === 403) {
    type = 'auth';
  } else if (res.status === 429) {
    type = 'rate_limit';
    retryable = true;
  } else if (res.status >= 500) {
    type = 'upstream_unavailable';
    retryable = true;
  } else {
    type = 'upstream_invalid';
  }
  const retryAfterHeader = res.headers.get('Retry-After');
  const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
  return new ConvAIError({
    code: legacyCode,
    type,
    message: `${contextMessage} (${res.status}): ${body}`,
    status: res.status,
    retryable,
    retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
  });
}

// ── Deprecation warnings (one-shot per process) ──────────────────────────────

const warnedOnce = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[voice-lib] DEPRECATION: ${message}`);
}

// ── Config normalization (flat → nested) ─────────────────────────────────────

function isFlatConfig(config: ConvAIAgentConfig): boolean {
  // Flat shape has top-level systemPrompt; nested has agent.systemPrompt.
  return 'systemPrompt' in config;
}

function isFlatOverrides(overrides: ConvAISessionOverrides): boolean {
  return (
    'systemPrompt' in overrides ||
    'firstMessage' in overrides ||
    'voiceId' in overrides ||
    'turnDetection' in overrides ||
    'expressiveMode' in overrides ||
    'suggestedAudioTags' in overrides
  );
}

function normalizeConfig(config: ConvAIAgentConfig): ConvAIAgentConfigNested {
  if (isFlatConfig(config)) {
    warnOnce(
      'flat-config',
      'Flat ConvAIAgentConfig shape (systemPrompt, modelId, etc. at the top level) is deprecated. ' +
        'Move to nested shape { agent: {...}, llm: {...}, tts: {...}, vad: {...}, session: {...} } ' +
        'before v0.4.0 — flat shape will be removed then.',
    );
    const flat = config as Extract<ConvAIAgentConfig, { systemPrompt: string }>;
    return {
      agent: {
        systemPrompt: flat.systemPrompt,
        firstMessage: flat.firstMessage,
        voiceId: flat.voiceId,
        agentName: flat.agentName,
      },
      llm: flat.llm,
      tts: {
        modelId: flat.modelId,
        stability: flat.stability,
        similarityBoost: flat.similarityBoost,
        expressiveMode: flat.expressiveMode,
        suggestedAudioTags: flat.suggestedAudioTags,
      },
      vad: flat.turnDetection,
      session: {
        maxDurationSeconds: flat.maxDurationSeconds,
        timeoutMs: flat.timeoutMs,
      },
    };
  }
  return config as ConvAIAgentConfigNested;
}

function normalizeOverrides(overrides: ConvAISessionOverrides): ConvAISessionOverridesNested {
  if (isFlatOverrides(overrides)) {
    warnOnce(
      'flat-overrides',
      'Flat ConvAISessionOverrides shape is deprecated. Move to nested shape ' +
        '{ agent: {...}, llm: {...}, tts: {...}, vad: {...} } before v0.4.0.',
    );
    const flat = overrides as Extract<ConvAISessionOverrides, { systemPrompt?: string }>;
    const nested: ConvAISessionOverridesNested = {};
    if (flat.systemPrompt !== undefined || flat.firstMessage !== undefined) {
      nested.agent = {};
      if (flat.systemPrompt !== undefined) nested.agent.systemPrompt = flat.systemPrompt;
      if (flat.firstMessage !== undefined) nested.agent.firstMessage = flat.firstMessage;
    }
    if (flat.llm) nested.llm = flat.llm;
    if (flat.voiceId !== undefined || flat.expressiveMode !== undefined || flat.suggestedAudioTags) {
      nested.tts = {};
      if (flat.voiceId !== undefined) nested.tts.modelId = nested.tts.modelId; // placeholder noop; voiceId handled separately
      // voiceId lives outside ConvAITTSConfigGroup in v0.3.1 — keep it on tts as a passthrough
      if (flat.expressiveMode !== undefined) nested.tts.expressiveMode = flat.expressiveMode;
      if (flat.suggestedAudioTags) nested.tts.suggestedAudioTags = flat.suggestedAudioTags;
    }
    if (flat.turnDetection) nested.vad = flat.turnDetection;
    // voiceId is special — it's part of agent identity in nested shape, but the
    // override path treats it as a TTS override. Stash it in agent for symmetry.
    if (flat.voiceId !== undefined) {
      nested.agent = { ...(nested.agent ?? {}), voiceId: flat.voiceId };
    }
    return nested;
  }
  return overrides as ConvAISessionOverridesNested;
}

// ── Payload builders (operate on canonical nested shape) ─────────────────────

function readSilenceDurationMs(td: ConvAITurnDetection): number | undefined {
  // Prefer camelCase; fall back to legacy snake_case with a deprecation warning.
  if (td.silenceDurationMs !== undefined) return td.silenceDurationMs;
  if (td.silence_duration_ms !== undefined) {
    warnOnce(
      'snake-case-silence-duration-ms',
      'ConvAITurnDetection.silence_duration_ms is deprecated. Rename to silenceDurationMs ' +
        'before v0.4.0 — snake_case form will be removed then.',
    );
    return td.silence_duration_ms;
  }
  return undefined;
}

function buildTurnDetectionPayload(turnDetection?: ConvAITurnDetection) {
  if (!turnDetection) return undefined;
  return {
    silence_duration_ms: readSilenceDurationMs(turnDetection),
    threshold: turnDetection.threshold,
  };
}

function isV3Model(modelId: string | undefined): boolean {
  return (modelId ?? 'eleven_v3_conversational').startsWith('eleven_v3');
}

function normalizeAudioTags(
  tags: ConvAITurnDetection extends never ? never : Array<string | { tag: string; description?: string }> | undefined,
): Array<{ tag: string; description?: string }> | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map(t => (typeof t === 'string' ? { tag: t } : t));
}

function buildPromptPayload(systemPrompt: string, llm?: ConvAILLMConfig) {
  return {
    prompt: systemPrompt,
    ...(llm?.model !== undefined && { llm: llm.model }),
    ...(llm?.temperature !== undefined && { temperature: llm.temperature }),
    ...(llm?.maxTokens !== undefined && { max_tokens: llm.maxTokens }),
  };
}

function buildTtsPayload(
  agent: ConvAIAgentConfigNested['agent'],
  tts: ConvAIAgentConfigNested['tts'],
) {
  const modelId = tts?.modelId ?? 'eleven_v3_conversational';
  const expressiveMode = tts?.expressiveMode ?? isV3Model(modelId);
  const normalizedTags = normalizeAudioTags(tts?.suggestedAudioTags);
  return {
    voice_id: agent.voiceId,
    model_id: modelId,
    stability: tts?.stability ?? 0.5,
    similarity_boost: tts?.similarityBoost ?? 0.75,
    expressive_mode: expressiveMode,
    ...(normalizedTags && { suggested_audio_tags: normalizedTags }),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create an ephemeral ConvAI agent and return connection credentials.
 *
 * Accepts either the v0.3.1+ nested config shape or the v0.2.x flat shape.
 * Flat input triggers a one-time deprecation warning per process.
 *
 * - ConvAI TTS accepts model_id 'eleven_v3_conversational' (default),
 *   'eleven_flash_v2_5', 'eleven_turbo_v2_5', or other ElevenLabs model IDs.
 *   See ELEVENLABS_MODELS for typed presets.
 * - voice_id lives on tts (not on agent.prompt) per the ElevenLabs schema.
 * - Returns both signed_url (WebSocket) and conversation_token (WebRTC);
 *   use whichever your @elevenlabs/react SDK version expects.
 */
export async function createConvAIAgent(
  config: ConvAIAgentConfig,
  apiKey?: string,
): Promise<ConvAIAgentResult> {
  const nested = normalizeConfig(config);
  const key = resolveKey(apiKey);
  const timeout = nested.session?.timeoutMs ?? 15000;
  const turnPayload = buildTurnDetectionPayload(nested.vad);

  // Step 1: Create agent
  const agentRes = await fetch(`${ELEVENLABS_API}/convai/agents/create`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: nested.agent.agentName,
      conversation_config: {
        agent: {
          prompt: buildPromptPayload(nested.agent.systemPrompt, nested.llm),
          first_message: nested.agent.firstMessage,
          // ElevenLabs default is 600s (10min); voice-lib default is 3600s (1hr).
          max_duration_seconds: nested.session?.maxDurationSeconds ?? 3600,
        },
        tts: buildTtsPayload(nested.agent, nested.tts),
        ...(turnPayload && { turn: turnPayload }),
      },
    }),
    signal: signal(timeout),
  });

  if (!agentRes.ok) {
    throw await errorFromResponse(
      agentRes,
      agentRes.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'AGENT_CREATION_FAILED',
      'ConvAI agent creation failed',
    );
  }

  const { agent_id: agentId } = await agentRes.json();

  // Step 2 & 3: Get token and signed URL in parallel
  let conversationToken: string | undefined;
  let signedUrl: string | undefined;

  const [tokenRes, signedRes] = await Promise.all([
    fetch(`${ELEVENLABS_API}/convai/conversation/token?agent_id=${agentId}`, {
      method: 'GET',
      headers: { 'xi-api-key': key },
      signal: signal(timeout),
    }),
    fetch(`${ELEVENLABS_API}/convai/conversation/get_signed_url?agent_id=${agentId}`, {
      method: 'GET',
      headers: { 'xi-api-key': key },
      signal: signal(timeout),
    }),
  ]);

  if (tokenRes.ok) {
    const tokenData = await tokenRes.json();
    conversationToken = tokenData.token;
  }
  if (signedRes.ok) {
    const signedData = await signedRes.json();
    signedUrl = signedData.signed_url;
  }

  return { agentId, conversationToken, signedUrl };
}

/**
 * Resolve a long-lived "universal" agent by creating it once and returning its ID.
 * The caller is responsible for caching — call once at server boot:
 *
 *   let agentIdPromise: Promise<string> | null = null;
 *   const getAgent = () => (agentIdPromise ??= resolveUniversalAgent('MyApp', BASE_CONFIG));
 */
export async function resolveUniversalAgent(
  name: string,
  baseConfig: ConvAIAgentConfig,
  apiKey?: string,
): Promise<string> {
  const nested = normalizeConfig(baseConfig);
  const key = resolveKey(apiKey);
  const timeout = nested.session?.timeoutMs ?? 15000;
  const turnPayload = buildTurnDetectionPayload(nested.vad);

  const res = await fetch(`${ELEVENLABS_API}/convai/agents/create`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      conversation_config: {
        agent: {
          prompt: buildPromptPayload(nested.agent.systemPrompt, nested.llm),
          first_message: nested.agent.firstMessage,
          max_duration_seconds: nested.session?.maxDurationSeconds ?? 3600,
        },
        tts: buildTtsPayload(nested.agent, nested.tts),
        ...(turnPayload && { turn: turnPayload }),
      },
    }),
    signal: signal(timeout),
  });

  if (!res.ok) {
    throw await errorFromResponse(
      res,
      res.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'AGENT_CREATION_FAILED',
      'Universal agent creation failed',
    );
  }

  const { agent_id } = await res.json();
  return agent_id as string;
}

/**
 * Get a signed URL for an existing agent with per-session overrides.
 * One API call (~200ms). Use with a cached `resolveUniversalAgent()`:
 *
 *   const agentId = await getAgent();
 *   const result = await getSignedUrlWithOverrides(agentId, {
 *     agent: { systemPrompt: '...', voiceId: '...' },
 *     llm: { model: 'gpt-4o-mini' },
 *   });
 *
 * Override is only honored if the agent's workspace-level
 * `overrides.conversation_config_override.agent.prompt.{prompt,llm}`
 * permissions allow it. Configure in the ElevenLabs dashboard.
 */
export async function getSignedUrlWithOverrides(
  agentId: string,
  overrides: ConvAISessionOverrides,
  apiKey?: string,
): Promise<ConvAIAgentResult> {
  const nested = normalizeOverrides(overrides);
  const key = resolveKey(apiKey);
  const timeoutMs = 15000;
  const turnPayload = buildTurnDetectionPayload(nested.vad);

  const conversationConfigOverride: Record<string, unknown> = {};

  // Agent overrides: prompt (with llm/temperature/max_tokens), first_message
  const hasLLMOverride = nested.llm && (
    nested.llm.model !== undefined ||
    nested.llm.temperature !== undefined ||
    nested.llm.maxTokens !== undefined
  );
  const systemPromptOverride = nested.agent?.systemPrompt;
  const firstMessageOverride = nested.agent?.firstMessage;
  if (systemPromptOverride !== undefined || firstMessageOverride !== undefined || hasLLMOverride) {
    const agentOverride: Record<string, unknown> = {};
    if (systemPromptOverride !== undefined || hasLLMOverride) {
      // Build prompt override field-by-field — only include keys explicitly
      // overridden. ElevenLabs treats every included key as an override, so
      // sending prompt: '' would wipe the base systemPrompt.
      const promptOverride: Record<string, unknown> = {};
      if (systemPromptOverride !== undefined) promptOverride.prompt = systemPromptOverride;
      if (nested.llm?.model !== undefined) promptOverride.llm = nested.llm.model;
      if (nested.llm?.temperature !== undefined) promptOverride.temperature = nested.llm.temperature;
      if (nested.llm?.maxTokens !== undefined) promptOverride.max_tokens = nested.llm.maxTokens;
      agentOverride.prompt = promptOverride;
    }
    if (firstMessageOverride !== undefined) {
      agentOverride.first_message = firstMessageOverride;
    }
    conversationConfigOverride.agent = agentOverride;
  }

  // TTS overrides: voice_id, expressive_mode, suggested_audio_tags
  const ttsOverride: Record<string, unknown> = {};
  if (nested.agent?.voiceId !== undefined) ttsOverride.voice_id = nested.agent.voiceId;
  if (nested.tts?.expressiveMode !== undefined) ttsOverride.expressive_mode = nested.tts.expressiveMode;
  const normalizedTags = normalizeAudioTags(nested.tts?.suggestedAudioTags);
  if (normalizedTags) ttsOverride.suggested_audio_tags = normalizedTags;
  if (Object.keys(ttsOverride).length > 0) {
    conversationConfigOverride.tts = ttsOverride;
  }

  if (turnPayload) conversationConfigOverride.turn = turnPayload;

  const res = await fetch(`${ELEVENLABS_API}/convai/conversation/get_signed_url`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: agentId,
      conversation_config_override: conversationConfigOverride,
    }),
    signal: signal(timeoutMs),
  });

  if (!res.ok) {
    throw await errorFromResponse(
      res,
      res.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'OVERRIDE_FAILED',
      'getSignedUrlWithOverrides failed',
    );
  }

  const data = await res.json();
  return { agentId, signedUrl: data.signed_url };
}

/** Delete an agent — call on session end for cleanup */
export async function deleteConvAIAgent(
  agentId: string,
  options?: { apiKey?: string; onError?: (err: Error) => void },
): Promise<void> {
  const key = options?.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) return; // Best-effort; don't throw on cleanup

  await fetch(`${ELEVENLABS_API}/convai/agents/${agentId}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': key },
  }).catch((err: unknown) => {
    options?.onError?.(err instanceof Error ? err : new Error(String(err)));
  });
}

/** Get a signed URL for an existing agent (no overrides). */
export async function getSignedUrl(agentId: string, apiKey?: string): Promise<string> {
  const key = resolveKey(apiKey);

  const res = await fetch(
    `${ELEVENLABS_API}/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { method: 'GET', headers: { 'xi-api-key': key }, signal: signal(15000) },
  );

  if (!res.ok) {
    throw await errorFromResponse(
      res,
      res.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'SIGNED_URL_FAILED',
      'Failed to get signed URL',
    );
  }

  const data = await res.json();
  return data.signed_url as string;
}
