/**
 * ConversationSession adapter interface (v0.4.3+).
 *
 * The React-side dispatch layer between `useConversation` and each ConvAI
 * backend's imperative SDK. The hook only talks to this interface; backend-
 * specific WebSocket/WebRTC details are encapsulated in per-backend
 * implementations (`elevenlabs-session.ts`, `hume-session.ts`).
 *
 * Design rationale: React's rules-of-hooks ban conditional sub-hook calls,
 * so we can't switch between `useElevenLabsConversation` and a hypothetical
 * `useHumeConversation` based on the agent route's response. Each backend
 * exposes an imperative API (`@elevenlabs/client`'s `Conversation.startSession`,
 * Hume's `HumeClient.empathicVoice.chat.connect`); we call those directly
 * from `useEffect`/`useCallback` and wrap them in this uniform interface.
 *
 * See development/rfc-v0.4.3-provider-aware-useConversation.md for the
 * full design context.
 */

import type { ConversationStatus } from '../hooks/useConversation';

/**
 * Live-session controller. Returned by `openElevenLabsSession()` /
 * `openHumeSession()`. Stashed in a `useRef` inside the hook so React state
 * machinery doesn't churn on each method call.
 */
export interface ConversationSession {
  /**
   * Close the session and release resources (WebSocket, AudioContext,
   * media tracks). Idempotent — calling twice is safe.
   */
  end(): Promise<void>;

  /**
   * Switch the active microphone mid-session. Backend-specific behaviour:
   *
   * - ElevenLabs (WebRTC path): also re-applies the SDK's audio constraints
   *   (echoCancellation, noiseSuppression, autoGainControl, channelCount: 1),
   *   which the initial track skips. This is the v0.2.1 COE-S11-001 fix.
   * - Hume: may throw `ConvAIError` with `code: 'NOT_SUPPORTED'` if the
   *   backend doesn't expose mid-session device switch (TBD during impl).
   */
  changeInputDevice(deviceId: string): Promise<void>;

  /** Switch the active audio output device mid-session. Backend-dependent. */
  changeOutputDevice(deviceId: string): Promise<void>;

  /**
   * Byte-frequency data (0–255 per bin) for the microphone input.
   * Returns an empty array when the underlying analyser isn't available yet
   * (e.g. right after `start()` while WebSocket is connecting).
   *
   * Drives `useInputBands`, `useInputLevel`, `<VoiceWaveform source="input">`.
   */
  getInputByteFrequencyData(): Uint8Array;

  /** Byte-frequency data for the agent's audio output. Drives output viz. */
  getOutputByteFrequencyData(): Uint8Array;

  /**
   * Current output volume scalar. ElevenLabs SDK returns 0 or 1 (legacy
   * quirk — that's why v0.4.2 added the FFT-based `useOutputLevel`).
   * The `<VoiceMeter>` / `useOutputLevel` hooks read this OR
   * `getOutputByteFrequencyData()` depending on what they need.
   */
  getOutputVolume(): number;
}

/**
 * Callbacks the hook passes into the session adapter. Each fires from inside
 * the adapter's event handlers; the hook converts them into React state
 * updates and user-facing callback invocations.
 */
export interface OpenSessionCallbacks {
  /**
   * Status transitions: 'connecting' → 'connected' → 'agent-speaking' /
   * 'user-speaking' → ... → 'disconnecting' → 'idle'. Backend adapters are
   * responsible for emitting status changes in a reasonable order.
   */
  onStatusChange(next: ConversationStatus): void;

  /** Agent or user turn transcript. */
  onMessage(role: 'agent' | 'user', text: string): void;

  /** Server-side VAD detected user interrupted the agent's response. */
  onInterruption(event: { eventId: number }): void;

  /** Fatal session error. The hook surfaces this as `result.error` + 'error' status. */
  onError(message: string): void;
}

/**
 * Options passed to the backend's `openSession` factory. Includes both the
 * callbacks and the request-time device-selection knobs.
 */
export interface OpenSessionOptions extends OpenSessionCallbacks {
  /** Mic device ID to use at session start. */
  inputDeviceId?: string;
  /** Audio output device ID to use at session start. */
  outputDeviceId?: string;
}

/**
 * The shape the Next ConvAI route handler returns. v0.4.3 adds the optional
 * `backend` field to drive dispatch in the React hook. Older routes that
 * don't set it default to `'elevenlabs'` for back-compat.
 */
export interface ConvAIRouteResponse {
  /**
   * Which backend produced this session. Optional for back-compat; defaults
   * to `'elevenlabs'` when missing.
   */
  backend?: 'elevenlabs' | 'hume' | 'cartesia-line' | 'openai-realtime';
  agent_id: string;
  /** WebSocket URL (ElevenLabs WS path OR Hume wss URL with access_token). */
  signed_url?: string;
  /** WebRTC token (ElevenLabs WebRTC path only). */
  conversation_token?: string;
}
