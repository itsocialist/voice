'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { TTSProviderName, VoiceProfile } from '../../src/types';

export type VoiceState = 'idle' | 'loading' | 'playing' | 'error';

export interface UseVoiceOptions {
  /** API route for TTS synthesis. Defaults to '/api/tts' */
  ttsRoute?: string;
  /** Auto-play when text changes */
  autoPlay?: boolean;
  /** Called when audio starts playing */
  onPlayStart?: () => void;
  /** Called when audio finishes */
  onPlayEnd?: () => void;
  /** Called on error */
  onError?: (error: string) => void;
}

export interface UseVoiceResult {
  state: VoiceState;
  provider: TTSProviderName | null;
  latencyMs: number | null;
  /** Synthesize and play text */
  speak: (
    text: string,
    options?: {
      profileKey?: string;
      voiceProfile?: VoiceProfile;
      provider?: TTSProviderName | 'browser';
    }
  ) => Promise<void>;
  stop: () => void;
  error: string | null;
}

export function useVoice(options: UseVoiceOptions = {}): UseVoiceResult {
  const { ttsRoute = '/api/tts', autoPlay = false, onPlayStart, onPlayEnd, onError } = options;

  const [state, setState] = useState<VoiceState>('idle');
  const [provider, setProvider] = useState<TTSProviderName | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setState('idle');
  }, []);

  const speak = useCallback(
    async (
      text: string,
      speakOptions: {
        profileKey?: string;
        voiceProfile?: VoiceProfile;
        provider?: TTSProviderName | 'browser';
      } = {}
    ) => {
      if (!text.trim()) return;

      setError(null);
      setState('loading');

      try {
        const response = await fetch(ttsRoute, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            profileKey: speakOptions.profileKey,
            voiceProfile: speakOptions.voiceProfile,
            provider: speakOptions.provider,
          }),
        });

        if (!response.ok) {
          throw new Error(`TTS request failed: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') ?? '';

        // Browser TTS signal
        if (contentType.includes('application/json')) {
          const json = await response.json();
          if (json.useBrowserTTS) {
            setState('playing');
            onPlayStart?.();
            await speakWithBrowser(json.text);
            setState('idle');
            onPlayEnd?.();
            return;
          }
          throw new Error(json.error ?? 'Unexpected JSON response from TTS route');
        }

        // Read provider metadata from headers
        const ttsProvider = response.headers.get('X-TTS-Provider') as TTSProviderName | null;
        const latency = response.headers.get('X-TTS-Latency-Ms');
        if (ttsProvider) setProvider(ttsProvider);
        if (latency) setLatencyMs(parseInt(latency, 10));

        // Revoke previous blob URL
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onplay = () => {
          setState('playing');
          onPlayStart?.();
        };
        audio.onended = () => {
          setState('idle');
          onPlayEnd?.();
        };
        audio.onerror = () => {
          setState('error');
          const msg = 'Audio playback failed';
          setError(msg);
          onError?.(msg);
        };

        await audio.play();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setState('error');
        setError(msg);
        onError?.(msg);
      }
    },
    [ttsRoute, onPlayStart, onPlayEnd, onError]
  );

  return { state, provider, latencyMs, speak, stop, error };
}

// ── Browser TTS fallback ──

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('Web Speech API not available'));
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => resolve();
    utter.onerror = (e) => reject(new Error(e.error));
    window.speechSynthesis.speak(utter);
  });
}
