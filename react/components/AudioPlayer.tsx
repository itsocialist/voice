'use client';

/**
 * AudioPlayer — plays TTS audio for a given text + voice profile.
 *
 * Generalized from sales-sim-trainer: removed domain-specific props
 * (subjectName/Age) in favor of profileKey or voiceProfile.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useVoice } from '../hooks/useVoice';
import type { VoiceProfile, TTSProviderName } from '../../src/types';

export interface AudioPlayerProps {
  text: string;
  /** Profile key to look up in the app's registry */
  profileKey?: string;
  /** Explicit voice profile (overrides profileKey) */
  voiceProfile?: VoiceProfile;
  /** Force a specific TTS provider */
  provider?: TTSProviderName | 'browser';
  autoPlay?: boolean;
  ttsRoute?: string;
  onPlayStart?: () => void;
  onPlayEnd?: () => void;
  className?: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  elevenlabs: '#3fd493',
  fish: '#60a5fa',
  openai: '#a78bfa',
};

export function AudioPlayer({
  text,
  profileKey,
  voiceProfile,
  provider,
  autoPlay = false,
  ttsRoute = '/api/tts',
  onPlayStart,
  onPlayEnd,
  className,
}: AudioPlayerProps) {
  const { state, provider: activeProvider, speak, stop } = useVoice({
    ttsRoute,
    onPlayStart,
    onPlayEnd,
  });

  const hasAutoPlayed = useRef(false);

  useEffect(() => {
    if (autoPlay && text && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      speak(text, { profileKey, voiceProfile, provider });
    }
  }, [autoPlay, text, profileKey, voiceProfile, provider, speak]);

  // Reset auto-play flag when text changes
  useEffect(() => { hasAutoPlayed.current = false; }, [text]);

  const handleClick = useCallback(() => {
    if (state === 'playing') {
      stop();
    } else {
      speak(text, { profileKey, voiceProfile, provider });
    }
  }, [state, text, profileKey, voiceProfile, provider, speak, stop]);

  const isLoading = state === 'loading';
  const isPlaying = state === 'playing';
  const providerColor = activeProvider ? (PROVIDER_COLORS[activeProvider] ?? '#888') : '#888';

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <button
        onClick={handleClick}
        disabled={isLoading}
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          background: isPlaying ? providerColor : 'var(--bg-input, #1a1a1a)',
          border: `1px solid ${isPlaying ? providerColor : 'var(--border-color, #333)'}`,
          color: isPlaying ? '#000' : 'var(--text-muted, #888)',
          cursor: isLoading ? 'wait' : 'pointer',
          opacity: isLoading ? 0.6 : 1,
        }}
        title={
          isLoading
            ? 'Generating...'
            : isPlaying
            ? `Stop (${activeProvider ?? ''})`
            : `Play${activeProvider ? ` (${activeProvider})` : ''}`
        }
      >
        {isLoading ? '●' : isPlaying ? '■' : '▶'}
      </button>

      {activeProvider && !isLoading && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: providerColor,
            flexShrink: 0,
          }}
          title={activeProvider}
        />
      )}
    </div>
  );
}

export default AudioPlayer;
