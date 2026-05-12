'use client';

/**
 * useVoiceDuplex — S7-TECH-06
 *
 * Provider-agnostic full-duplex voice hook for SpeakerHero.
 * Wraps the voice-lib useConversation abstraction, decoupling the
 * component layer from any direct @elevenlabs/* SDK dependency.
 *
 * Future: swap `provider` to 'cartesia' | 'deepgram' without touching
 * any component code.
 *
 * Usage:
 *   const conv = useVoiceDuplex({
 *     provider: 'elevenlabs',   // default
 *     agentRoute: '/api/convai/agent',
 *     buildConfig: () => ({ systemPrompt, firstMessage, voiceId }),
 *     onMessage: (role, text) => ...,
 *     inputDeviceId: selectedMicId,   // optional H/W selection
 *     outputDeviceId: selectedSpeakerId,
 *   });
 *   <button onClick={conv.start}>Start</button>
 *   if (conv.micPermission === 'denied') return <MicBlockedScreen />;
 */

import { useConversation } from './useConversation';
import type { UseConversationOptions, UseConversationResult, ConversationStatus, MicPermissionState } from './useConversation';

export type VoiceDuplexProviderName = 'elevenlabs' | 'cartesia' | 'deepgram';

export interface UseVoiceDuplexOptions extends UseConversationOptions {
    /**
     * The voice provider to use.
     * Currently only 'elevenlabs' is implemented — this param is reserved
     * for future provider switching without API changes.
     * @default 'elevenlabs'
     */
    provider?: VoiceDuplexProviderName;
}

export type { UseConversationResult as UseVoiceDuplexResult, ConversationStatus, MicPermissionState };

/**
 * useVoiceDuplex — provider-agnostic full-duplex voice conversation hook.
 * Currently delegates to the ElevenLabs ConvAI implementation via useConversation.
 */
export function useVoiceDuplex(options: UseVoiceDuplexOptions): UseConversationResult {
    const { provider: _provider = 'elevenlabs', ...conversationOptions } = options;
    // Provider routing reserved for future: cartesia, deepgram, etc.
    return useConversation(conversationOptions);
}
