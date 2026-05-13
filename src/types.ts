// ─────────────────────────────────────────────
// @itsocialist/voice — Core Types
// ─────────────────────────────────────────────

// ── Provider Names ──

export type TTSProviderName = 'elevenlabs' | 'fish' | 'openai' | 'cartesia' | 'deepgram';
export type STTProviderName = 'webspeech' | 'deepgram';

// ── Voice Profile ──
// Maps a single voice identity across all TTS providers.
// Apps define their own profiles and register them via VoiceRegistry.

/**
 * Voice profile — maps a single voice identity across TTS providers.
 *
 * v0.3.2 widened the type: previously the `elevenlabsVoiceId`, `fishModelId`,
 * and `openaiVoice` fields (and the corresponding `elevenlabsSettings` /
 * `fishSettings`) were all required. You couldn't register a profile that
 * only targeted Cartesia without supplying placeholder ElevenLabs/Fish/OpenAI
 * data. Those fields are now optional. If you route a request to a provider
 * whose ID is missing on the profile, the router logs a warning and the
 * provider falls back to a default voice — not silent fallback.
 */
export interface VoiceProfile {
  /** Human-readable name (e.g. "Warm Female Professional") */
  name: string;

  // Provider-specific voice IDs (all optional from v0.3.2+)
  elevenlabsVoiceId?: string;
  fishModelId?: string;
  openaiVoice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  cartesiaVoiceId?: string;
  deepgramVoiceId?: string;

  // Metadata
  gender?: 'male' | 'female';
  ageRange?: 'young' | 'middle' | 'senior';
  /** Description of voice style/personality for reference */
  style?: string;

  // Per-provider tuning (all optional from v0.3.2+)
  elevenlabsSettings?: {
    stability: number;          // 0.0–1.0: lower = more expressive
    similarity_boost: number;   // 0.0–1.0: higher = more faithful to voice
    style: number;              // 0.0–1.0: higher = more dramatic
    use_speaker_boost: boolean;
  };
  fishSettings?: {
    temperature: number;        // 0.0–1.0: expressiveness
    top_p: number;              // 0.0–1.0: diversity
    speed: number;              // 0.5–2.0
  };
}

// ── TTS ──

export interface TTSRequest {
  text: string;
  voiceProfile: VoiceProfile;
  format?: 'mp3' | 'wav' | 'opus';
  /**
   * Override the default provider (TTS_PROVIDER env) for this request only.
   * 'browser' is a special value — the server returns a signal and the
   * client handles synthesis via Web Speech API.
   */
  preferredProvider?: TTSProviderName | 'browser';
}

export interface TTSResponse {
  audioBuffer: ArrayBuffer;
  contentType: string;
  provider: TTSProviderName;
  latencyMs: number;
}

/**
 * Returned by `synthesizeSpeechStream()`. Stream begins arriving before
 * full synthesis completes (assuming the provider supports real streaming).
 *
 * v0.4.0 removed the legacy `stream` field. Use `chunks` (AsyncIterable)
 * with `for await`, or `toReadableStream()` for a Web ReadableStream.
 */
export interface TTSStreamResponse {
  /**
   * AsyncIterable of audio chunks. Modern runtimes implement AsyncIterable
   * on ReadableStream, so this is the same underlying object as the one
   * `toReadableStream()` returns — just typed for composability.
   */
  chunks: AsyncIterable<Uint8Array>;
  contentType: string;
  provider: TTSProviderName;
  /** Adapter when you need a Web ReadableStream (e.g. for `new Response(stream)`). */
  toReadableStream(): ReadableStream<Uint8Array>;
}

/** Returned when preferredProvider === 'browser' */
export interface BrowserTTSSignal {
  useBrowserTTS: true;
  text: string;
}

export interface TTSProvider {
  name: TTSProviderName;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  /**
   * Stream audio chunks as they arrive (lower TTFA). Only implemented by
   * providers that actually do incremental delivery — see `supportsStreaming`
   * for the truth-flag the router honors.
   */
  synthesizeStream?(request: TTSRequest): Promise<TTSStreamResponse>;
  /**
   * Whether this provider's `synthesizeStream` actually streams chunks as
   * they generate (`true`) versus buffering server-side and emitting a
   * single chunk at the end (`false` or `undefined`).
   *
   * The router uses this to decide whether to (a) call `synthesizeStream`
   * directly or (b) fall back to wrapping `synthesize()` output in a
   * one-chunk stream and emit a clear "not actually streaming" warning.
   *
   * As of v0.3.2: ElevenLabs (`true`) is the only TTS provider with real
   * incremental streaming. Cartesia + Deepgram require their WebSocket
   * endpoints for true streaming — not yet implemented here.
   */
  supportsStreaming?: boolean;
  isAvailable(): boolean;
}

// ── STT ──

export interface STTRequest {
  audioBuffer: ArrayBuffer;
  contentType: string;
  language?: string;
}

export interface STTResponse {
  transcript: string;
  confidence: number;
  provider: STTProviderName;
  latencyMs: number;
  isFinal: boolean;
}

export interface STTProvider {
  name: STTProviderName;
  transcribe(request: STTRequest): Promise<STTResponse>;
  isAvailable(): boolean;
}

// ── Provider Status ──

export interface TTSProviderStatus {
  /**
   * The provider that would be selected for an unspecified request given
   * current env config. `null` when no provider is available — v0.3.2+
   * change; v0.2.x threw on this path.
   */
  primary: TTSProviderName | null;
  available: TTSProviderName[];
  fallbacks: TTSProviderName[];
}

export interface STTProviderStatus {
  primary: string;
  available: string[];
  clientSide: string[];
  note: string;
}

// ── ConvAI ──

/**
 * VAD turn detection config for ConvAI sessions.
 *
 * v0.4.0 removed the legacy snake_case `silence_duration_ms` field. Use
 * `silenceDurationMs` (introduced v0.3.1).
 */
export interface ConvAITurnDetection {
  type: 'server_vad';
  /** Silence duration before turn handoff (ms). ElevenLabs default ~700; recommend 400 for sales sims. */
  silenceDurationMs?: number;
  /** VAD sensitivity (0.0–1.0). */
  threshold?: number;
}

/**
 * Audio tag entry for `suggestedAudioTags`. A plain string is shorthand for
 * `{ tag }`; objects let you attach a usage hint that the LLM can use to
 * decide when to apply the tag.
 */
export type ConvAISuggestedAudioTag = string | { tag: string; description?: string };

/**
 * LLM configuration for the ConvAI agent's response generation.
 * Maps to `conversation_config.agent.prompt.{llm, temperature, max_tokens}`.
 * Verified against the ElevenLabs API 2026-05-12 — all three fields accepted
 * and echoed back on subsequent GET.
 *
 * In v0.3.0 this nested shape will be the canonical config layout; flat
 * top-level fields (modelId, stability, etc) will move into sibling groups
 * (tts, vad, session). Adopt the nested shape now to avoid migration churn.
 */
export interface ConvAILLMConfig {
  /**
   * LLM identifier as accepted by ElevenLabs ConvAI. Common values:
   * `'gpt-4o-mini'`, `'gpt-4o'`, `'claude-sonnet-4'`, `'gemini-2.0-flash'`.
   * When omitted, ElevenLabs picks its account default.
   */
  model?: string;
  /** Sampling temperature 0.0–1.0. When omitted, ElevenLabs default applies. */
  temperature?: number;
  /** Max output tokens. Pass `-1` for unlimited. When omitted, default applies. */
  maxTokens?: number;
}

/**
 * Identity-level config: systemPrompt, firstMessage, voiceId, agentName.
 *
 * These four were top-level on `ConvAIAgentConfig` in v0.2.x. They were
 * regrouped into `agent: {...}` in v0.3.1 to keep the parent config from
 * becoming a kitchen sink (per SDK design review). Flat top-level fields
 * are still accepted on input for v0.3.x with a runtime deprecation
 * warning; nested form is canonical.
 */
export interface ConvAIAgentIdentity {
  systemPrompt: string;
  firstMessage: string;
  /** ElevenLabs voice ID */
  voiceId: string;
  agentName: string;
}

/**
 * TTS-related config grouped together. Maps to the `conversation_config.tts`
 * object on the ElevenLabs API. Use {@link ELEVENLABS_MODELS} for typed
 * `modelId` values.
 */
export interface ConvAITTSConfigGroup {
  /**
   * ElevenLabs TTS model ID.
   * @default 'eleven_v3_conversational' — Scribe v2 Realtime with emotional cues.
   * See {@link ELEVENLABS_MODELS} for typed presets.
   */
  modelId?: string;
  /** TTS stability (0.0–1.0). v3 default: 0.5. */
  stability?: number;
  /** TTS similarity boost (0.0–1.0). Default: 0.75. */
  similarityBoost?: number;
  /**
   * Enables expressive audio-tag prompt augmentation in the LLM and TTS-side
   * tag interpretation. Defaults to `true` when `modelId` is a v3 family model.
   * No effect on non-v3 models (silently disabled upstream).
   */
  expressiveMode?: boolean;
  /**
   * Constrains the LLM to prefer this set of audio tags. Max 20.
   * Reduces the failure mode where the model invents tags that get
   * spoken aloud instead of interpreted as performance cues.
   */
  suggestedAudioTags?: ConvAISuggestedAudioTag[];
}

/**
 * Session policy: duration limits and request timeouts.
 */
export interface ConvAISessionPolicy {
  /**
   * Max conversation duration (seconds). voice-lib default 3600 (1hr);
   * ElevenLabs default is 600.
   */
  maxDurationSeconds?: number;
  /** Per-fetch timeout for ElevenLabs API calls. voice-lib default 15000ms. */
  timeoutMs?: number;
}

/**
 * ConvAI agent config (v0.4.0+).
 *
 *   agent — systemPrompt / firstMessage / voiceId / agentName
 *   llm — model / temperature / maxTokens (ConvAI agent LLM, v0.2.4+)
 *   tts — modelId / stability / similarityBoost / expressiveMode / suggestedAudioTags
 *   vad — turn-detection config
 *   session — maxDurationSeconds / timeoutMs
 *
 * v0.4.0 removed the legacy flat shape from v0.2.x (single top-level
 * `systemPrompt`, `voiceId`, etc.). Use the nested shape.
 */
export interface ConvAIAgentConfig {
  agent: ConvAIAgentIdentity;
  llm?: ConvAILLMConfig;
  tts?: ConvAITTSConfigGroup;
  vad?: ConvAITurnDetection;
  session?: ConvAISessionPolicy;
}

/**
 * @deprecated alias retained for v0.3.x type imports. Will be removed
 * in v0.5.0. Use `ConvAIAgentConfig` directly.
 */
export type ConvAIAgentConfigNested = ConvAIAgentConfig;

export interface ConvAIAgentResult {
  agentId: string;
  /** Signed WebSocket URL (legacy — valid ~15 min) */
  signedUrl?: string;
  /** WebRTC conversation token (newer API) */
  conversationToken?: string;
}

/**
 * Per-session overrides passed to `getSignedUrlWithOverrides()`.
 * Applied on top of a cached universal agent's base config.
 *
 * v0.4.0 removed the legacy flat overrides shape from v0.2.x. Use the
 * nested shape directly. Override is only honored if the agent's
 * `overrides.conversation_config_override.agent.prompt` permissions allow
 * it — configure in the ElevenLabs dashboard.
 */
export interface ConvAISessionOverrides {
  agent?: Partial<ConvAIAgentIdentity>;
  llm?: ConvAILLMConfig;
  tts?: ConvAITTSConfigGroup;
  vad?: ConvAITurnDetection;
}

/**
 * @deprecated alias retained for v0.3.x type imports. Will be removed
 * in v0.5.0. Use `ConvAISessionOverrides` directly.
 */
export type ConvAISessionOverridesNested = ConvAISessionOverrides;

// ── Next.js Route Handler Types ──

export interface TTSRouteBody {
  text: string;
  /** Profile key to look up in registry */
  profileKey?: string;
  /** Explicit profile (bypasses registry) */
  voiceProfile?: VoiceProfile;
  /** Per-request provider override */
  provider?: TTSProviderName | 'browser';
  format?: 'mp3' | 'wav' | 'opus';
}

export interface STTRouteResponse {
  transcript: string;
  confidence: number;
  provider: STTProviderName;
  latencyMs: number;
}

/**
 * POST body for the ConvAI Next.js route handler. Accepts the same nested
 * or flat shape as `ConvAIAgentConfig` — the handler passes the body
 * through to `createConvAIAgent` which normalizes both forms.
 */
export type ConvAIAgentRouteBody = ConvAIAgentConfig;
