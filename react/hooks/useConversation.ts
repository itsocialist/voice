'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ConvAIAgentConfig } from '../../src/types';
import { openSession } from '../sessions/dispatch';
import type { ConversationSession, ConvAIRouteResponse } from '../sessions/types';

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
   * v0.3.3+ — passthrough from the underlying SDK's onInterruption callback.
   * No programmatic agent-interrupt API exists; you can stop the session
   * entirely via stop() if you need a hard stop.
   */
  onInterruption?: (event: { eventId: number }) => void;
  /**
   * MediaDevices deviceId for the microphone to use.
   * Passed to getUserMedia and forwarded to the underlying SDK startSession.
   * Enumerate available devices with navigator.mediaDevices.enumerateDevices().
   */
  inputDeviceId?: string;
  /**
   * MediaDevices deviceId for the audio output device.
   * Forwarded to the underlying SDK startSession (SDK support required).
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

  // The active session (set when start() succeeds, cleared on stop / onDisconnect).
  // Replaces v0.4.2's elevenRef — now backend-agnostic via the adapter.
  const sessionRef = useRef<ConversationSession | null>(null);

  // Keep callbacks in refs so hook options never need to change identity.
  // This prevents the session adapter from being recreated on every parent render.
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

      const data = await res.json() as ConvAIRouteResponse;
      agentIdRef.current = data.agent_id;
      console.log(
        '[voice-lib] Agent created:',
        data.agent_id,
        '| backend:', data.backend ?? 'elevenlabs',
        '| signed_url:', !!data.signed_url,
        '| conversation_token:', !!data.conversation_token,
      );

      // Request mic permission before connecting — getUserMedia must be called
      // from a user-gesture context. If denied, throw a clear error.
      // CRITICAL: Stop the stream immediately after permission check.
      // The underlying SDK calls getUserMedia internally — on macOS Chrome,
      // two concurrent streams cause the second to receive silence.
      // See COE-S11-001 for the full post-mortem.
      const audioConstraints: MediaTrackConstraints = inputDeviceId
        ? { deviceId: { exact: inputDeviceId } }
        : {};
      const permStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      permStream.getTracks().forEach(t => t.stop());
      console.log('[voice-lib] Mic permission granted (stream released) — opening session...');

      // v0.4.3: dispatch on backend (data.backend, defaults to 'elevenlabs').
      // openSession() switches over the backend and lazy-imports the
      // appropriate adapter (Hume SDK isn't loaded unless backend === 'hume').
      const session = await openSession(data, {
        onStatusChange: (next) => updateStatus(next),
        onMessage: (role, text) => onMessageRef.current?.(role, text),
        onInterruption: (event) => {
          setLastInterruptionAt(Date.now());
          onInterruptionRef.current?.(event);
        },
        onError: (msg) => {
          setError(msg);
          updateStatus('error');
          onErrorRef.current?.(msg);
        },
        inputDeviceId,
        outputDeviceId,
      });
      sessionRef.current = session;
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
      await sessionRef.current?.end();
    } catch {
      // Ignore errors on disconnect — session may already be closed
    }
    sessionRef.current = null;

    if (agentIdRef.current) {
      fetch(`${agentRoute}?agent_id=${agentIdRef.current}`, { method: 'DELETE' }).catch(() => {});
      agentIdRef.current = null;
    }

    updateStatus('idle');
  }, [agentRoute, updateStatus]);

  const changeInputDevice = useCallback(async (deviceId: string) => {
    await sessionRef.current?.changeInputDevice(deviceId);
  }, []);

  const changeOutputDevice = useCallback(async (deviceId: string) => {
    await sessionRef.current?.changeOutputDevice(deviceId);
  }, []);

  // Volume + frequency data getters. These read sessionRef.current at call
  // time (the visualization hooks call them inside their rAF loops). When
  // no session is active they return safe defaults so consumers don't have
  // to guard against undefined.
  const getInputByteFrequencyData = useCallback((): Uint8Array => {
    return sessionRef.current?.getInputByteFrequencyData() ?? new Uint8Array(0);
  }, []);

  const getOutputByteFrequencyData = useCallback((): Uint8Array => {
    return sessionRef.current?.getOutputByteFrequencyData() ?? new Uint8Array(0);
  }, []);

  return {
    status,
    isSpeaking: status === 'agent-speaking',
    agentVolume: sessionRef.current?.getOutputVolume() ?? 0,
    error,
    micPermission,
    lastInterruptionAt,
    start,
    stop,
    changeInputDevice,
    changeOutputDevice,
    getInputByteFrequencyData,
    getOutputByteFrequencyData,
  };
}
