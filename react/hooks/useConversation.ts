'use client';

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
  agentRoute?: string;
  buildConfig: () => ConvAIAgentConfig | Promise<ConvAIAgentConfig>;
  onMessage?: (role: 'agent' | 'user', text: string) => void;
  onStatusChange?: (status: ConversationStatus) => void;
  onError?: (error: string) => void;
}

export interface UseConversationResult {
  status: ConversationStatus;
  isSpeaking: boolean;
  agentVolume: number;
  error: string | null;
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
    onError: (msg: string | Error) => {
      const err = typeof msg === 'string' ? msg : msg.message || 'Conversation error';
      setError(err);
      updateStatus('error');
      onError?.(err);
    },
  });

  const start = useCallback(async () => {
    setError(null);
    updateStatus('connecting');

    try {
      const config = await buildConfig();
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

      await navigator.mediaDevices.getUserMedia({ audio: true });

      if (data.conversation_token) {
        // startSession returns void in v1
        elevenlabs.startSession({ conversationToken: data.conversation_token });
      } else if (data.signed_url) {
        elevenlabs.startSession({ signedUrl: data.signed_url });
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
      elevenlabs.endSession();
    } catch {
      // Ignore errors on disconnect
    }

    if (agentIdRef.current) {
      fetch(`${agentRoute}?agent_id=${agentIdRef.current}`, { method: 'DELETE' }).catch(() => {});
      agentIdRef.current = null;
    }

    updateStatus('idle');
  }, [agentRoute, elevenlabs, updateStatus]);

  return {
    status,
    isSpeaking: status === 'agent-speaking',
    // In v1, getOutputVolume returns number 0-1
    agentVolume: elevenlabs.getOutputVolume ? elevenlabs.getOutputVolume() : (elevenlabs.isSpeaking ? 1 : 0),
    error,
    start,
    stop,
    getInputByteFrequencyData: elevenlabs.getInputByteFrequencyData,
    getOutputByteFrequencyData: elevenlabs.getOutputByteFrequencyData,
  };
}
