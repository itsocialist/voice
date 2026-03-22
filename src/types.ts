// ─────────────────────────────────────────────
// @briandawson/voice — Core Types
// ─────────────────────────────────────────────

// ── Provider Names ──

export type TTSProviderName = 'elevenlabs' | 'fish' | 'openai';
export type STTProviderName = 'webspeech' | 'deepgram';

// ── Voice Profile ──
// Maps a single voice identity across all TTS providers.
// Apps define their own profiles and register them via VoiceRegistry.

export interface VoiceProfile {
  /** Human-readable name (e.g. "Warm Female Professional") */
  name: string;

  // Provider-specific voice IDs
  elevenlabsVoiceId: string;
  fishModelId: string;
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

  // Metadata
  gender: 'male' | 'female';
  ageRange: 'young' | 'middle' | 'senior';
  /** Description of voice style/personality for reference */
  style?: string;

  // Per-provider tuning
  elevenlabsSettings: {
    stability: number;          // 0.0–1.0: lower = more expressive
    similarity_boost: number;   // 0.0–1.0: higher = more faithful to voice
    style: number;              // 0.0–1.0: higher = more dramatic
    use_speaker_boost: boolean;
  };
  fishSettings: {
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

/** Returned when preferredProvider === 'browser' */
export interface BrowserTTSSignal {
  useBrowserTTS: true;
  text: string;
}

export interface TTSProvider {
  name: TTSProviderName;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
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
  primary: TTSProviderName;
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

export interface ConvAIAgentConfig {
  systemPrompt: string;
  firstMessage: string;
  /** ElevenLabs voice ID */
  voiceId: string;
  agentName: string;
}

export interface ConvAIAgentResult {
  agentId: string;
  /** Signed WebSocket URL (legacy — valid ~15 min) */
  signedUrl?: string;
  /** WebRTC conversation token (newer API) */
  conversationToken?: string;
}

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

export interface ConvAIAgentRouteBody {
  systemPrompt: string;
  firstMessage: string;
  voiceId: string;
  agentName: string;
}
