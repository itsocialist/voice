'use client';

/**
 * ElevenLabs ConvAI session adapter (v0.4.3+).
 *
 * Wraps `@elevenlabs/client`'s `Conversation.startSession()` imperative API
 * in voice-lib's `ConversationSession` interface. Replaces the v0.4.2 hook-
 * coupled approach (`useElevenLabsConversation()` sub-hook) so the React
 * dispatch layer can switch backends per session without violating React's
 * rules-of-hooks.
 *
 * Behavioral parity with v0.4.2:
 * - Identical mic-permission timing (perm stream stopped before SDK touches
 *   the mic) — preserves the v0.2.0 COE-S11-001 macOS dual-stream fix.
 * - WebRTC initial-mic-track audio-constraints re-apply (v0.2.1 fix for
 *   built-in MacBook mics) — moved from the hook into this adapter unchanged.
 * - Same status transition shape: connecting → connected → agent-speaking /
 *   user-speaking → idle.
 * - Same role-vs-source dual handling on `onMessage` (the SDK passes both
 *   the legacy `source: 'ai' | 'user'` and the current `role: 'agent' | 'user'`).
 *
 * See development/rfc-v0.4.3-provider-aware-useConversation.md.
 */

import { Conversation, type VoiceConversation } from '@elevenlabs/client';
import { ConvAIError } from '../../src/convai/client';
import type {
  ConversationSession,
  ConvAIRouteResponse,
  OpenSessionOptions,
} from './types';

export async function openElevenLabsSession(
  data: ConvAIRouteResponse,
  opts: OpenSessionOptions,
): Promise<ConversationSession> {
  // Pick transport: signed_url → WebSocket; conversation_token → WebRTC.
  // ElevenLabs routes may return either or both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionConfig: any = data.signed_url
    ? { signedUrl: data.signed_url }
    : data.conversation_token
      ? { conversationToken: data.conversation_token }
      : null;

  if (!sessionConfig) {
    throw new ConvAIError({
      code: 'NO_CREDENTIALS',
      type: 'upstream_invalid',
      provider: 'elevenlabs',
      message: 'ElevenLabs agent route returned neither signed_url nor conversation_token.',
      retryable: false,
    });
  }

  // Top-level inputDeviceId / outputDeviceId. WebSocket path honors these at
  // startSession; WebRTC path needs a separate changeInputDevice call after
  // onConnect (v0.2.1 fix — handled below).
  if (opts.inputDeviceId) sessionConfig.inputDeviceId = opts.inputDeviceId;
  if (opts.outputDeviceId) sessionConfig.outputDeviceId = opts.outputDeviceId;

  // Wire callbacks. We match the existing hook's behavior:
  // - onConnect → status 'connected'
  // - onDisconnect → status 'idle'
  // - onModeChange → status 'agent-speaking' / 'user-speaking'
  // - onMessage → opts.onMessage with role-vs-source resolution
  // - onError → opts.onError
  // - onInterruption → opts.onInterruption with normalized { eventId }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionConfig.onConnect = ({ conversationId }: { conversationId: string }) => {
    console.log('[voice-lib] onConnect — conversationId:', conversationId);
    opts.onStatusChange('connected');
  };
  sessionConfig.onDisconnect = () => {
    console.log('[voice-lib] onDisconnect');
    opts.onStatusChange('idle');
  };
  sessionConfig.onMessage = (props: {
    message: string;
    source: 'ai' | 'user';
    role?: 'agent' | 'user';
  }) => {
    const role = props.role ?? (props.source === 'ai' ? 'agent' : 'user');
    opts.onMessage(role, props.message);
  };
  sessionConfig.onModeChange = (props: { mode: 'speaking' | 'listening' }) => {
    opts.onStatusChange(props.mode === 'speaking' ? 'agent-speaking' : 'user-speaking');
  };
  sessionConfig.onError = (msg: string) => {
    const err = typeof msg === 'string' ? msg : 'Conversation error';
    console.error('[voice-lib] SDK onError:', err);
    opts.onError(err);
  };
  sessionConfig.onInterruption = (event: { event_id: number }) => {
    opts.onInterruption({ eventId: event.event_id });
  };

  // Open the session. Returns a VoiceConversation (the imperative session
  // instance) on the .startSession overload that's voice (not text-only).
  const conversation = await Conversation.startSession(sessionConfig) as VoiceConversation;
  console.log('[voice-lib] startSession() resolved — awaiting onConnect callback...');

  // v0.2.1 WebRTC initial-mic-track audio-constraints fix (COE-S11-001 follow-up).
  // The WebRTC path constructs new Room() with no audioCaptureDefaults, so the
  // initial mic track inherits browser defaults — busted on built-in MacBook
  // mics. Calling changeInputDevice post-connect re-acquires with the SDK's
  // good constraints (echoCancellation, noiseSuppression, autoGainControl,
  // channelCount: 1).
  if (data.conversation_token && opts.inputDeviceId) {
    conversation.changeInputDevice({ inputDeviceId: opts.inputDeviceId })
      .catch((err: unknown) => {
        console.warn('[voice-lib] post-connect changeInputDevice failed:', err);
      });
  }

  return {
    end: () => conversation.endSession(),
    changeInputDevice: (deviceId: string) =>
      conversation.changeInputDevice({ inputDeviceId: deviceId }),
    changeOutputDevice: (deviceId: string) =>
      conversation.changeOutputDevice({ outputDeviceId: deviceId }),
    getInputByteFrequencyData: () => conversation.getInputByteFrequencyData(),
    getOutputByteFrequencyData: () => conversation.getOutputByteFrequencyData(),
    getOutputVolume: () => conversation.getOutputVolume(),
  };
}
