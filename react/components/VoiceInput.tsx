'use client';

/**
 * VoiceInput — microphone button with Web Speech API (browser STT).
 * Spacebar hotkey support. Interim transcript display.
 */

import { useSTT } from '../hooks/useSTT';

export interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  /** Trigger this after transcription (e.g., auto-submit) */
  onAutoSend?: () => void;
  autoSend?: boolean;
  className?: string;
}

export function VoiceInput({
  onTranscript,
  disabled = false,
  onAutoSend,
  autoSend = false,
  className,
}: VoiceInputProps) {
  const { state, interimText, isSupported, micPermission, toggle } = useSTT({
    mode: 'browser',
    onTranscript: (text) => {
      onTranscript(text);
      if (autoSend && onAutoSend) setTimeout(onAutoSend, 300);
    },
    spacebarHotkey: !disabled,
  });

  const isListening = state === 'listening';

  if (!isSupported) {
    return (
      <MicButton disabled title="Speech recognition not supported in this browser">
        <MicOffIcon />
      </MicButton>
    );
  }

  if (micPermission === 'denied') {
    return (
      <MicButton disabled style={{ borderColor: '#ef4444', color: '#ef4444' }}
        title="Microphone access denied. Enable in browser settings.">
        <MicOffIcon />
      </MicButton>
    );
  }

  return (
    <div className={`relative flex items-center ${className ?? ''}`}>
      <MicButton
        onClick={toggle}
        disabled={disabled}
        style={{
          background: isListening ? 'var(--accent-primary, #3fd493)' : 'var(--bg-input, #1a1a1a)',
          borderColor: isListening ? 'var(--accent-primary, #3fd493)' : 'var(--border-color, #333)',
          color: isListening ? '#000' : 'var(--text-muted, #888)',
          boxShadow: isListening ? '0 0 20px rgba(63,212,151,0.4)' : 'none',
        }}
        title={isListening ? 'Stop recording (Space)' : 'Start recording (Space)'}
      >
        {isListening ? <MicActiveIcon /> : <MicIcon />}
      </MicButton>

      {isListening && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          border: '2px solid var(--accent-primary, #3fd493)',
          animation: 'mic-pulse 1.5s ease-in-out infinite',
          opacity: 0.5,
        }} />
      )}

      {interimText && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%',
          transform: 'translateX(-50%)', marginBottom: 8,
          padding: '6px 12px', fontSize: 14, whiteSpace: 'nowrap',
          maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis',
          background: 'var(--bg-card, #111)', border: '1px solid var(--accent-primary, #3fd493)',
          color: 'var(--text-secondary, #aaa)',
        }}>
          {interimText}
          <span style={{ color: 'var(--accent-primary, #3fd493)', animation: 'pulse 1s infinite' }}>▋</span>
        </div>
      )}
    </div>
  );
}

// ── Internal helpers ──

function MicButton({ children, style, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      style={{
        width: 48, height: 48, display: 'flex', alignItems: 'center',
        justifyContent: 'center', border: '2px solid var(--border-color, #333)',
        cursor: 'pointer', transition: 'all 0.15s', ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <rect x="9" y="2" width="6" height="12" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function MicActiveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="square">
      <rect x="9" y="2" width="6" height="12" />
      <path d="M5 10a7 7 0 0 0 14 0" fill="none" strokeWidth="2" />
      <line x1="12" y1="19" x2="12" y2="22" strokeWidth="2" />
      <line x1="8" y1="22" x2="16" y2="22" strokeWidth="2" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <rect x="9" y="2" width="6" height="12" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
      <line x1="2" y1="2" x2="22" y2="22" strokeWidth="2.5" stroke="#ef4444" />
    </svg>
  );
}

export default VoiceInput;
