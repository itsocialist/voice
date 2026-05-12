/**
 * ElevenLabs ConvAI — Server-side client
 *
 * Creates and manages ephemeral ConvAI agents.
 * Returns both signed_url (legacy WebSocket) and conversation_token (WebRTC)
 * so consuming apps can choose whichever the ElevenLabs SDK version expects.
 */

import type { ConvAIAgentConfig, ConvAIAgentResult, ConvAISessionOverrides } from '../types';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// ── Typed error ───────────────────────────────────────────────────────────────

export class ConvAIError extends Error {
  constructor(
    public readonly code:
      | 'API_KEY_MISSING'
      | 'AGENT_CREATION_FAILED'
      | 'SIGNED_URL_FAILED'
      | 'ELEVENLABS_UNAVAILABLE'
      | 'OVERRIDE_FAILED',
    message: string,
    /** Upstream HTTP status, if available */
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ConvAIError';
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

function buildTurnDetectionPayload(turnDetection?: ConvAIAgentConfig['turnDetection']) {
  if (!turnDetection) return undefined;
  return {
    silence_duration_ms: turnDetection.silence_duration_ms,
    threshold: turnDetection.threshold,
  };
}

function isV3Model(modelId: string | undefined): boolean {
  return (modelId ?? 'eleven_v3_conversational').startsWith('eleven_v3');
}

function normalizeAudioTags(
  tags: ConvAIAgentConfig['suggestedAudioTags']
): Array<{ tag: string; description?: string }> | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map(t => (typeof t === 'string' ? { tag: t } : t));
}

/**
 * Build the `tts` payload sent to ElevenLabs, including the RQ-11
 * expressive fields. `expressiveMode` defaults to `true` on v3 models per the
 * SpeakerHero recommendation; ElevenLabs silently no-ops both fields on
 * non-v3 models so passing them is safe.
 */
function buildTtsPayload(config: {
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  expressiveMode?: boolean;
  suggestedAudioTags?: ConvAIAgentConfig['suggestedAudioTags'];
}) {
  const modelId = config.modelId ?? 'eleven_v3_conversational';
  const expressiveMode = config.expressiveMode ?? isV3Model(modelId);
  const normalizedTags = normalizeAudioTags(config.suggestedAudioTags);
  return {
    voice_id: config.voiceId,
    model_id: modelId,
    stability: config.stability ?? 0.5,
    similarity_boost: config.similarityBoost ?? 0.75,
    expressive_mode: expressiveMode,
    ...(normalizedTags && { suggested_audio_tags: normalizedTags }),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create an ephemeral ConvAI agent and return connection credentials.
 *
 * Notes:
 * - ConvAI TTS accepts model_id: 'eleven_v3_conversational' (default, shipped Feb 2026),
 *   'eleven_flash_v2', or 'eleven_turbo_v2'. v3 includes Scribe v2 Realtime emotional cues.
 * - voice_id in tts config (not in agent.prompt) is the correct placement
 * - Returns both signed_url and conversation_token; use whichever your SDK needs
 */
export async function createConvAIAgent(
  config: ConvAIAgentConfig,
  apiKey?: string
): Promise<ConvAIAgentResult> {
  const key = resolveKey(apiKey);
  const timeout = config.timeoutMs ?? 15000;

  const turnPayload = buildTurnDetectionPayload(config.turnDetection);

  // Step 1: Create agent
  const agentRes = await fetch(`${ELEVENLABS_API}/convai/agents/create`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: config.agentName,
      conversation_config: {
        agent: {
          prompt: { prompt: config.systemPrompt },
          first_message: config.firstMessage,
          // max_duration_seconds: SpeakerHero uses 3600 (1hr). ElevenLabs default is 600s (10min).
          max_duration_seconds: config.maxDurationSeconds ?? 3600,
        },
        // S12-VOICE: default model eleven_v3_conversational (Scribe v2 Realtime,
        // emotional cues). Stability 0.5 calibrated for v3 (was 0.4 for flash_v2).
        // RQ-11: expressiveMode defaults true on v3; suggestedAudioTags forwarded as-is.
        tts: buildTtsPayload(config),
        ...(turnPayload && { turn: turnPayload }),
      },
    }),
    signal: signal(timeout),
  });

  if (!agentRes.ok) {
    const err = await agentRes.text();
    const code = agentRes.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'AGENT_CREATION_FAILED';
    throw new ConvAIError(code, `ConvAI agent creation failed (${agentRes.status}): ${err}`, agentRes.status);
  }

  const { agent_id: agentId } = await agentRes.json();

  // Step 2 & 3: Get token and signed URL in parallel to reduce setup latency
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
  apiKey?: string
): Promise<string> {
  const key = resolveKey(apiKey);
  const timeout = baseConfig.timeoutMs ?? 15000;

  const turnPayload = buildTurnDetectionPayload(baseConfig.turnDetection);

  const res = await fetch(`${ELEVENLABS_API}/convai/agents/create`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      conversation_config: {
        agent: {
          prompt: { prompt: baseConfig.systemPrompt },
          first_message: baseConfig.firstMessage,
          max_duration_seconds: baseConfig.maxDurationSeconds ?? 3600,
        },
        tts: buildTtsPayload(baseConfig),
        ...(turnPayload && { turn: turnPayload }),
      },
    }),
    signal: signal(timeout),
  });

  if (!res.ok) {
    const err = await res.text();
    const code = res.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'AGENT_CREATION_FAILED';
    throw new ConvAIError(code, `Universal agent creation failed (${res.status}): ${err}`, res.status);
  }

  const { agent_id } = await res.json();
  return agent_id as string;
}

/**
 * Get a signed URL for an existing agent with per-session overrides.
 * One API call (~200ms). Use with resolveUniversalAgent() cached at boot:
 *
 *   const agentId = await getAgent();
 *   const result = await getSignedUrlWithOverrides(agentId, { systemPrompt, voiceId });
 */
export async function getSignedUrlWithOverrides(
  agentId: string,
  overrides: ConvAISessionOverrides,
  apiKey?: string
): Promise<ConvAIAgentResult> {
  const key = resolveKey(apiKey);
  const timeoutMs = 15000;

  const turnPayload = buildTurnDetectionPayload(overrides.turnDetection);

  const conversationConfigOverride: Record<string, unknown> = {};
  if (overrides.systemPrompt !== undefined || overrides.firstMessage !== undefined) {
    conversationConfigOverride.agent = {
      ...(overrides.systemPrompt !== undefined && { prompt: { prompt: overrides.systemPrompt } }),
      ...(overrides.firstMessage !== undefined && { first_message: overrides.firstMessage }),
    };
  }
  const ttsOverride: Record<string, unknown> = {};
  if (overrides.voiceId !== undefined) {
    ttsOverride.voice_id = overrides.voiceId;
  }
  if (overrides.expressiveMode !== undefined) {
    ttsOverride.expressive_mode = overrides.expressiveMode;
  }
  const normalizedTags = normalizeAudioTags(overrides.suggestedAudioTags);
  if (normalizedTags) {
    ttsOverride.suggested_audio_tags = normalizedTags;
  }
  if (Object.keys(ttsOverride).length > 0) {
    conversationConfigOverride.tts = ttsOverride;
  }
  if (turnPayload) {
    conversationConfigOverride.turn = turnPayload;
  }

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
    const err = await res.text();
    const code = res.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'OVERRIDE_FAILED';
    throw new ConvAIError(code, `getSignedUrlWithOverrides failed (${res.status}): ${err}`, res.status);
  }

  const data = await res.json();
  return { agentId, signedUrl: data.signed_url };
}

/** Delete an agent — call on session end for cleanup */
export async function deleteConvAIAgent(
  agentId: string,
  options?: { apiKey?: string; onError?: (err: Error) => void }
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

/** Get a signed URL for an existing agent (no overrides) */
export async function getSignedUrl(
  agentId: string,
  apiKey?: string
): Promise<string> {
  const key = resolveKey(apiKey);

  const res = await fetch(
    `${ELEVENLABS_API}/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { method: 'GET', headers: { 'xi-api-key': key }, signal: signal(15000) }
  );

  if (!res.ok) {
    const code = res.status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'SIGNED_URL_FAILED';
    throw new ConvAIError(code, `Failed to get signed URL (${res.status}): ${await res.text()}`, res.status);
  }

  const data = await res.json();
  return data.signed_url as string;
}
