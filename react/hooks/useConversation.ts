'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useConversation as useElevenLabsConversation } from '@elevenlabs/react';
import type { ConvAIAgentConfig } from '../../src/types';

export type ConversationStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'agent-speaking'
  | 'user-speaking'
  | 'disconnecting'
  | 'error';

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface UseConversationOptions {
  agentRoute?: string;
  buildConfig: () => ConvAIAgentConfig | Promise<ConvAIAgentConfig>;
  onMessage?: (role: 'agent' | 'user', text: string) => void;
  onStatusChange?: (status: ConversationStatus) => void;
  onError?: (error: string) => void;
  /**
   * Fires when the agent is interrupted — typically by server-side VAD
   * detecting that the user has started speaking while the agent is mid-
   * response. Useful for showing "interrupted" affordances in the UI, or
   * for telemetry counting natural barge-ins.
   *
   * v0.3.3+ — passthrough from the @elevenlabs/react onInterruption callback.
   * No programmatic agent-interrupt API exists in the SDK; you can stop the
   * session entirely via stop() if you need a hard stop.
   */
  onInterruption?: (event: { eventId: number }) => void;
  /**
   * MediaDevices deviceId for the microphone to use.
   * Passed to getUserMedia and forwarded to the ElevenLabs SDK startSession.
   * Enumerate available devices with navigator.mediaDevices.enumerateDevices().
   */
  inputDeviceId?: string;
  /**
   * MediaDevices deviceId for the audio output device.
   * Forwarded to the ElevenLabs SDK startSession (SDK support required).
   */
  outputDeviceId?: string;
}

export interface UseConversationResult {
  status: ConversationStatus;
  isSpeaking: boolean;
  agentVolume: number;
  error: string | null;
  /** Live mic permission state. Subscribes to OS-level changes via Permissions API. */
  micPermission: MicPermissionState;
  /**
   * Timestamp (ms since epoch) of the most recent agent interruption event,
   * or `null` if the agent has not been interrupted this session. Resets on
   * session start. Useful for "agent was interrupted" UI flashes without
   * needing a separate state variable in the consumer.
   */
  lastInterruptionAt: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /**
   * Switch the active microphone mid-session. On the WebRTC transport this
   * also re-applies the SDK's audio constraints (echoCancellation,
   * noiseSuppression, autoGainControl, channelCount: 1) — which the WebRTC
   * path does NOT apply on its initial track. No-op when the session is idle.
   */
  changeInputDevice: (inputDeviceId: string) => Promise<void>;
  /** Switch the active audio output device mid-session. No-op when idle. */
  changeOutputDevice: (outputDeviceId: string) => Promise<void>;
  getInputByteFrequencyData?: () => Uint8Array;
  getOutputByteFrequencyData?: () => Uint8Array;
}

export function useConversation(options: UseConversationOptions): UseConversationResult {
  const {
    agentRoute = '/api/convai/agent',
    buildConfig,
    onMessage,
    onStatusChange,
    onError,
    onInterruption,
    inputDeviceId,
    outputDeviceId,
  } = options;

  const [status, setStatus] = useState<ConversationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<MicPermissionState>('unknown');
  const [lastInterruptionAt, setLastInterruptionAt] = useState<number | null>(null);
  const agentIdRef = useRef<string | null>(null);
  // Which SDK transport the active session is using. WebRTC initial mic track
  // ignores constraint defaults; we re-apply via changeInputDevice in onConnect.
  const transportRef = useRef<'websocket' | 'webrtc' | null>(null);
  // Carry inputDeviceId into onConnect so the WebRTC auto-fix can use it.
  // Stored in a ref so onConnect's identity stays stable.
  const pendingInputDeviceIdRef = useRef<string | undefined>(undefined);

  // Keep callbacks in refs so hook options never need to change identity.
  // This prevents the ElevenLabs hook from being recreated on every parent render.
  const onStatusChangeRef = useRef(onStatusChange);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onInterruptionRef = useRef(onInterruption);
  onStatusChangeRef.current = onStatusChange;
  onMessageRef.current = onMessage;
  onErrorRef.current = onError;
  onInterruptionRef.current = onInterruption;

  // ── Mic permission monitoring (RQ-06) ─────────────────────────────────────
  // Subscribe to OS-level mic permission changes via Permissions API.
  // Safe to no-op on browsers that don't support it (Safari iOS).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;

    let permissionStatus: PermissionStatus | null = null;

    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((ps) => {
        permissionStatus = ps;
        setMicPermission(ps.state as MicPermissionState);
        ps.onchange = () => setMicPermission(ps.state as MicPermissionState);
      })
      .catch(() => {
        // Permissions API not available or microphone query not supported
      });

    return () => {
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, []);

  // updateStatus is stable — no external deps, reads callbacks from refs
  const updateStatus = useCallback((next: ConversationStatus) => {
    setStatus(next);
    onStatusChangeRef.current?.(next);
  }, []);

  // ── @elevenlabs/react v1.3 API ─────────────────────────────────────────────
  // - useConversation() takes callbacks via HookOptions (registered with provider context)
  // - startSession(opts?: HookOptions) receives SessionConfig as top-level fields:
  //   { signedUrl } | { conversationToken } | { agentId }
  //   NOT nested as { signedUrl: { ... } }
  // - onConnect receives { conversationId: string }
  // - onError receives (message: string, context?: any)
  // - onMessage receives { message, source (deprecated), role }
  const elevenlabs = useElevenLabsConversation({
    onConnect: ({ conversationId }: { conversationId: string }) => {
      console.log('[voice-lib] onConnect — conversationId:', conversationId);
      updateStatus('connected');
      // WebRTC initial mic track skips the SDK's defaultConstraints
      // (echoCancellation, noiseSuppression, autoGainControl, channelCount:1).
      // Post-connect changeInputDevice DOES apply them. Auto-fire it so
      // consumers don't have to reach into the SDK manually.
      const deviceId = pendingInputDeviceIdRef.current;
      if (transportRef.current === 'webrtc' && deviceId) {
        elevenRef.current.changeInputDevice({ inputDeviceId: deviceId })
          .catch((err: unknown) => {
            console.warn('[voice-lib] post-connect changeInputDevice failed:', err);
          });
      }
    },
    onDisconnect: () => {
      console.log('[voice-lib] onDisconnect');
      updateStatus('idle');
      agentIdRef.current = null;
      transportRef.current = null;
      pendingInputDeviceIdRef.current = undefined;
    },
    onMessage: (props: { message: string; source: 'ai' | 'user'; role?: 'agent' | 'user' }) => {
      // role is the current field; source is deprecated but kept for safety
      const role = props.role ?? (props.source === 'ai' ? 'agent' : 'user');
      onMessageRef.current?.(role, props.message);
    },
    onModeChange: (props: { mode: 'speaking' | 'listening' }) => {
      updateStatus(props.mode === 'speaking' ? 'agent-speaking' : 'user-speaking');
    },
    onError: (msg: string) => {
      const err = typeof msg === 'string' ? msg : 'Conversation error';
      console.error('[voice-lib] SDK onError:', err);
      setError(err);
      updateStatus('error');
      onErrorRef.current?.(err);
    },
    // Barge-in (v0.3.3+): server-side VAD detected the user speaking while
    // the agent was mid-response. SDK has already cut the agent's audio at
    // the output controller. We record the timestamp for UI use and forward
    // the event to the consumer's optional callback.
    onInterruption: (event: { event_id: number }) => {
      const now = Date.now();
      setLastInterruptionAt(now);
      onInterruptionRef.current?.({ eventId: event.event_id });
    },
  });

  // Stable ref to ElevenLabs instance — avoids `elevenlabs` being in dep arrays
  // (it changes identity every render from the hook above)
  const elevenRef = useRef(elevenlabs);
  elevenRef.current = elevenlabs;

  const start = useCallback(async () => {
    setError(null);
    setLastInterruptionAt(null);
    updateStatus('connecting');

    try {
      const config = await buildConfig();
      console.log('[voice-lib] Fetching agent from', agentRoute);
      const res = await fetch(agentRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Agent creation failed (${res.status})`);
      }

      const data = await res.json();
      agentIdRef.current = data.agent_id;
      console.log('[voice-lib] Agent created:', data.agent_id, '| signed_url:', !!data.signed_url);

      // Request mic permission before connecting — getUserMedia must be called
      // from a user-gesture context. If denied, throw a clear error.
      // CRITICAL: Stop the stream immediately after permission check.
      // The ElevenLabs SDK calls getUserMedia internally — on macOS Chrome,
      // two concurrent streams cause the second to receive silence.
      // See COE-S11-001 for the full post-mortem.
      const audioConstraints: MediaTrackConstraints = inputDeviceId
        ? { deviceId: { exact: inputDeviceId } }
        : {};
      const permStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      permStream.getTracks().forEach(t => t.stop());
      console.log('[voice-lib] Mic permission granted (stream released) — calling startSession...');

      // Stash inputDeviceId for onConnect (WebRTC needs to re-apply post-connect).
      pendingInputDeviceIdRef.current = inputDeviceId;

      // v1.3: startSession(HookOptions) — { signedUrl } picks WebSocket, { conversationToken } picks WebRTC.
      // Routes may return either; prefer signed_url for backward compatibility.
      if (data.signed_url) {
        transportRef.current = 'websocket';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (elevenRef.current.startSession as any)({
          signedUrl: data.signed_url,
          ...(inputDeviceId && { inputDeviceId }),
          ...(outputDeviceId && { outputDeviceId }),
        });
      } else if (data.conversation_token) {
        transportRef.current = 'webrtc';
        // WebRTC ignores top-level inputDeviceId at init; onConnect re-applies via changeInputDevice.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (elevenRef.current.startSession as any)({
          conversationToken: data.conversation_token,
          ...(outputDeviceId && { outputDeviceId }),
        });
      } else {
        throw new Error('Agent route returned neither signed_url nor conversation_token');
      }
      console.log('[voice-lib] startSession() resolved — awaiting onConnect callback...');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start conversation';
      console.error('[voice-lib] start() caught error:', msg);
      setError(msg);
      updateStatus('error');
      onErrorRef.current?.(msg);
    }
  }, [agentRoute, buildConfig, updateStatus, inputDeviceId, outputDeviceId]);

  const stop = useCallback(async () => {
    updateStatus('disconnecting');
    try {
      elevenRef.current.endSession();
    } catch {
      // Ignore errors on disconnect — session may already be closed
    }

    if (agentIdRef.current) {
      fetch(`${agentRoute}?agent_id=${agentIdRef.current}`, { method: 'DELETE' }).catch(() => {});
      agentIdRef.current = null;
    }

    transportRef.current = null;
    pendingInputDeviceIdRef.current = undefined;
    updateStatus('idle');
  }, [agentRoute, updateStatus]);

  const changeInputDevice = useCallback(async (deviceId: string) => {
    pendingInputDeviceIdRef.current = deviceId;
    await elevenRef.current.changeInputDevice({ inputDeviceId: deviceId });
  }, []);

  const changeOutputDevice = useCallback(async (deviceId: string) => {
    await elevenRef.current.changeOutputDevice({ outputDeviceId: deviceId });
  }, []);

  return {
    status,
    isSpeaking: status === 'agent-speaking',
    agentVolume: elevenRef.current.getOutputVolume(),
    error,
    micPermission,
    lastInterruptionAt,
    start,
    stop,
    changeInputDevice,
    changeOutputDevice,
    getInputByteFrequencyData: elevenRef.current.getInputByteFrequencyData,
    getOutputByteFrequencyData: elevenRef.current.getOutputByteFrequencyData,
  };
}
