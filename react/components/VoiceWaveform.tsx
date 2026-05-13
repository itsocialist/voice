'use client';

/**
 * <VoiceWaveform> — frequency-band bar visualizer for ConvAI sessions (v0.4.2+).
 *
 * Drop-in for the 80% case: hand it a `conv` object from `useConversation`
 * or `useVoiceDuplex`, pick a `source`, and it renders log-spaced bars
 * that animate with the audio. Self-managing rAF loop via `useInputBands`
 * / `useOutputBands` hooks.
 *
 * Examples:
 *
 *   <VoiceWaveform conv={conv} source="input"  bands={24} />
 *   <VoiceWaveform conv={conv} source="output" bands={16} barColor="#0af" />
 *
 * The component renders plain `<div>` bars with CSS height transforms.
 * For more performance-critical use, drop to `useInputBands` directly and
 * render to a canvas.
 */

import { useInputBands, useOutputBands } from '../hooks/useVoiceLevel';
import type { UseConversationResult } from '../hooks/useConversation';

export interface VoiceWaveformProps {
  /** The `useConversation` / `useVoiceDuplex` result. */
  conv: UseConversationResult;
  /** Which audio stream to visualize. */
  source: 'input' | 'output';
  /** Number of frequency bands to render. Default 24. */
  bands?: number;
  /**
   * Smoothing factor 0–1 applied across animation frames. Higher = smoother
   * + slower; lower = snappier + more jittery. Default 0.7.
   */
  smoothing?: number;
  /** Bar color (CSS color string). Default `currentColor`. */
  barColor?: string;
  /** Gap between bars in px. Default 2. */
  gapPx?: number;
  /** Minimum bar height in px (so silent bars are still visible). Default 2. */
  minHeightPx?: number;
  /** Container className for layout/sizing. Container is a flex row. */
  className?: string;
  /** Inline style merged into the container. */
  style?: React.CSSProperties;
}

export function VoiceWaveform({
  conv,
  source,
  bands = 24,
  smoothing = 0.7,
  barColor = 'currentColor',
  gapPx = 2,
  minHeightPx = 2,
  className,
  style,
}: VoiceWaveformProps) {
  const inputBands = useInputBands(conv, source === 'input' ? bands : 0, { smoothing });
  const outputBands = useOutputBands(conv, source === 'output' ? bands : 0, { smoothing });
  const values = source === 'input' ? inputBands : outputBands;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: `${gapPx}px`,
        ...style,
      }}
      role="img"
      aria-label={`${source} audio frequency visualization`}
    >
      {Array.from(values).map((v, i) => {
        const heightPct = Math.max(0, Math.min(1, v)) * 100;
        return (
          <div
            key={i}
            style={{
              flex: '1 1 0',
              height: `max(${minHeightPx}px, ${heightPct}%)`,
              background: barColor,
              borderRadius: 2,
              transition: 'height 60ms linear',
            }}
          />
        );
      })}
    </div>
  );
}
