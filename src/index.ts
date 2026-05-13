// @itsocialist/voice — Server/Node exports
// Import from '@itsocialist/voice'

// Types
export type {
  TTSProviderName,
  STTProviderName,
  VoiceProfile,
  TTSRequest,
  TTSResponse,
  TTSStreamResponse,
  BrowserTTSSignal,
  TTSProvider,
  STTRequest,
  STTResponse,
  STTProvider,
  TTSProviderStatus,
  STTProviderStatus,
  ConvAIAgentConfig,
  ConvAIAgentConfigNested,
  ConvAIAgentConfigFlat,
  ConvAIAgentIdentity,
  ConvAITTSConfigGroup,
  ConvAISessionPolicy,
  ConvAIAgentResult,
  ConvAITurnDetection,
  ConvAISessionOverrides,
  ConvAISessionOverridesNested,
  ConvAISessionOverridesFlat,
  ConvAISuggestedAudioTag,
  ConvAILLMConfig,
  TTSRouteBody,
  STTRouteResponse,
  ConvAIAgentRouteBody,
} from './types';


// TTS providers (for direct use if needed)
export { ElevenLabsProvider } from './providers/tts/elevenlabs';
export { FishAudioProvider } from './providers/tts/fish-audio';
export { OpenAITTSProvider } from './providers/tts/openai';
export { CartesiaProvider } from './providers/tts/cartesia';
export { DeepgramTTSProvider } from './providers/tts/deepgram';

// STT providers
export { DeepgramSTTProvider } from './providers/stt/deepgram';

// TTS router
export { synthesizeSpeech, synthesizeSpeechStream, getProviderStatus, resetProviders } from './router/tts';

// STT router
export { transcribeAudio, getSTTStatus } from './router/stt';

// Profile registry
export { VoiceRegistry, voiceRegistry, DEFAULT_VOICE_PROFILE } from './profiles/registry';

// ConvAI — v0.2.x function surface (unchanged, still primary for existing code)
export {
  createConvAIAgent,
  resolveUniversalAgent,
  getSignedUrlWithOverrides,
  deleteConvAIAgent,
  getSignedUrl,
  ConvAIError,
} from './convai/client';
export type {
  ConvAIErrorType,
  ConvAIProviderId,
  ConvAILegacyCode,
  ConvAIErrorDetails,
} from './convai/client';

// ConvAI — v0.3.3+ backend abstraction (additive). Use for new code and
// for forward-compat with v0.4+ multi-backend support (Hume / Cartesia
// Line / OpenAI Realtime).
export {
  createConvAI,
  setDefaultConvAIBackend,
  startConvAISession,
  resumeConvAISession,
  endConvAISession,
} from './convai/backend';
export type {
  ConvAIBackend,
  ConvAIClient,
  ConvAISessionHandle,
  ConvAISessionStartOpts,
} from './convai/backend';
export { elevenlabs } from './convai/backends/elevenlabs';
export type { ElevenLabsBackendOptions } from './convai/backends/elevenlabs';

export { ELEVENLABS_MODELS } from './convai/models';
export type { ElevenLabsModelId } from './convai/models';
