// @briandawson/voice — Server/Node exports
// Import from '@briandawson/voice'

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
  ConvAIAgentResult,
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

// ConvAI
export { createConvAIAgent, deleteConvAIAgent, getSignedUrl } from './convai/client';
