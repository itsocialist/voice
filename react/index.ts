// @itsocialist/voice/react — React hooks and components

// Hooks
export { useVoice } from './hooks/useVoice';
export type { UseVoiceOptions, UseVoiceResult, VoiceState } from './hooks/useVoice';

export { useSTT } from './hooks/useSTT';
export type { UseSTTOptions, UseSTTResult, STTState, STTMode } from './hooks/useSTT';

export { useConversation } from './hooks/useConversation';
export type { UseConversationOptions, UseConversationResult, ConversationStatus, MicPermissionState } from './hooks/useConversation';

export { useVoiceDuplex } from './hooks/useVoiceDuplex';
export type { UseVoiceDuplexOptions, UseVoiceDuplexResult, VoiceDuplexProviderName, MicPermissionState as VoiceDuplexMicPermission } from './hooks/useVoiceDuplex';

// Components
export { VoiceDuplexProvider } from './components/VoiceDuplexProvider';

export { AudioPlayer } from './components/AudioPlayer';
export type { AudioPlayerProps } from './components/AudioPlayer';

export { VoiceInput } from './components/VoiceInput';
export type { VoiceInputProps } from './components/VoiceInput';
