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
        tts: {
          voice_id: config.voiceId,
          // S12-VOICE: Upgraded from eleven_flash_v2 → eleven_v3_conversational
          // per Voice Realism Engineering Report (May 9, 2026). v3 ships Scribe v2
          // Realtime with emotional cues and improved turn-taking.
          model_id: config.modelId ?? 'eleven_v3_conversational',
          // Stability recalibrated for v3 response curve (was 0.4 for flash_v2).
          // v3 reads stability differently — 0.5 gives natural variation without drift.
          stability: config.stability ?? 0.5,
          similarity_boost: config.similarityBoost ?? 0.75,
        },
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
        tts: {
          voice_id: baseConfig.voiceId,
          model_id: baseConfig.modelId ?? 'eleven_v3_conversational',
          stability: baseConfig.stability ?? 0.5,
          similarity_boost: baseConfig.similarityBoost ?? 0.75,
        },
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
  if (overrides.voiceId !== undefined) {
    conversationConfigOverride.tts = { voice_id: overrides.voiceId };
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
