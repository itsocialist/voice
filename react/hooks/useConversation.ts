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
  start: () => Promise<void>;
  stop: () => Promise<void>;
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
    inputDeviceId,
    outputDeviceId,
  } = options;

  const [status, setStatus] = useState<ConversationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<MicPermissionState>('unknown');
  const agentIdRef = useRef<string | null>(null);

  // Keep callbacks in refs so hook options never need to change identity.
  // This prevents the ElevenLabs hook from being recreated on every parent render.
  const onStatusChangeRef = useRef(onStatusChange);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  onStatusChangeRef.current = onStatusChange;
  onMessageRef.current = onMessage;
  onErrorRef.current = onError;

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
    },
    onDisconnect: () => {
      console.log('[voice-lib] onDisconnect');
      updateStatus('idle');
      agentIdRef.current = null;
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
  });

  // Stable ref to ElevenLabs instance — avoids `elevenlabs` being in dep arrays
  // (it changes identity every render from the hook above)
  const elevenRef = useRef(elevenlabs);
  elevenRef.current = elevenlabs;

  const start = useCallback(async () => {
    setError(null);
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

      // v1.3: startSession(HookOptions) — signedUrl is a TOP-LEVEL field, not nested
      if (data.signed_url) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (elevenRef.current.startSession as any)({
          signedUrl: data.signed_url,
          ...(inputDeviceId && { inputDeviceId }),
          ...(outputDeviceId && { outputDeviceId }),
        });
      } else {
        throw new Error('No signed_url returned from agent route');
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

    updateStatus('idle');
  }, [agentRoute, updateStatus]);

  return {
    status,
    isSpeaking: status === 'agent-speaking',
    agentVolume: elevenRef.current.getOutputVolume(),
    error,
    micPermission,
    start,
    stop,
    getInputByteFrequencyData: elevenRef.current.getInputByteFrequencyData,
    getOutputByteFrequencyData: elevenRef.current.getOutputByteFrequencyData,
  };
}
