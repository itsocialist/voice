'use client';

/**
 * useConversation — Generic ElevenLabs ConvAI hook
 *
 * Handles the full lifecycle:
 *   idle → connecting → connected → (agent speaking ↔ user speaking) → disconnected
 *
 * The app provides a function to build the agent config (system prompt, first
 * message, voice ID) — this hook handles agent creation, SDK connection, and cleanup.
 *
 * Usage:
 *   const conv = useConversation({
 *     agentRoute: '/api/convai/agent',
 *     buildConfig: () => ({
 *       systemPrompt: '...',
 *       firstMessage: 'Hello!',
 *       voiceId: 'YOUR_ELEVENLABS_VOICE_ID',
 *       agentName: 'Assistant',
 *     }),
 *     onMessage: (role, text) => console.log(role, text),
 *   })
 *
 *   <button onClick={conv.start}>Start</button>
 *   <button onClick={conv.stop}>Stop</button>
 */

import { useState, useRef, useCallback } from 'react';
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

export interface UseConversationOptions {
  /** Route that creates the ephemeral agent. Defaults to '/api/convai/agent' */
  agentRoute?: string;
  /**
   * Called before connecting — return the agent config.
   * Can be async (e.g., to fetch scenario data).
   */
  buildConfig: () => ConvAIAgentConfig | Promise<ConvAIAgentConfig>;
  /** Called when the agent or user speaks */
  onMessage?: (role: 'agent' | 'user', text: string) => void;
  /** Called when status changes */
  onStatusChange?: (status: ConversationStatus) => void;
  /** Called on unrecoverable error */
  onError?: (error: string) => void;
}

export interface UseConversationResult {
  status: ConversationStatus;
  isSpeaking: boolean;
  /** 0.0–1.0 volume level of the agent's current speech */
  agentVolume: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useConversation(options: UseConversationOptions): UseConversationResult {
  const {
    agentRoute = '/api/convai/agent',
    buildConfig,
    onMessage,
    onStatusChange,
    onError,
  } = options;

  const [status, setStatus] = useState<ConversationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const agentIdRef = useRef<string | null>(null);

  const updateStatus = useCallback(
    (next: ConversationStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  // ElevenLabs SDK hook
  const elevenlabs = useElevenLabsConversation({
    onConnect: () => updateStatus('connected'),
    onDisconnect: () => {
      updateStatus('idle');
      agentIdRef.current = null;
    },
    onMessage: (props: { message: string; source: 'ai' | 'user' }) => {
      onMessage?.(props.source === 'ai' ? 'agent' : 'user', props.message);
    },
    onModeChange: (props: { mode: 'speaking' | 'listening' }) => {
      updateStatus(props.mode === 'speaking' ? 'agent-speaking' : 'user-speaking');
    },
    onError: (msg: string) => {
      const err = typeof msg === 'string' ? msg : 'Conversation error';
      setError(err);
      updateStatus('error');
      onError?.(err);
    },
  });

  const start = useCallback(async () => {
    setError(null);
    updateStatus('connecting');

    try {
      // 1. Build agent config from calling app
      const config = await buildConfig();

      // 2. Create ephemeral agent via server route
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

      // 3. Request mic access
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // 4. Connect via ElevenLabs SDK
      // Prefer conversation_token (WebRTC) over signed_url (WebSocket)
      if (data.conversation_token) {
        await elevenlabs.startSession({ conversationToken: data.conversation_token });
      } else if (data.signed_url) {
        await elevenlabs.startSession({ signedUrl: data.signed_url });
      } else {
        throw new Error('No connection credentials returned from agent route');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start conversation';
      setError(msg);
      updateStatus('error');
      onError?.(msg);
    }
  }, [agentRoute, buildConfig, elevenlabs, updateStatus, onError]);

  const stop = useCallback(async () => {
    updateStatus('disconnecting');
    try {
      await elevenlabs.endSession();
    } catch {
      // Ignore errors on disconnect
    }

    // Best-effort agent cleanup
    if (agentIdRef.current) {
      fetch(`${agentRoute}?agent_id=${agentIdRef.current}`, { method: 'DELETE' }).catch(() => {});
      agentIdRef.current = null;
    }

    updateStatus('idle');
  }, [agentRoute, elevenlabs, updateStatus]);

  return {
    status,
    isSpeaking: status === 'agent-speaking',
    agentVolume: elevenlabs.isSpeaking ? 1 : 0,
    error,
    start,
    stop,
  };
}
