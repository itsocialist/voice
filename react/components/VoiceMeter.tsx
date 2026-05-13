'use client';

/**
 * <VoiceMeter> — single-value RMS volume meter (v0.4.2+).
 *
 * Drop-in for the "is the agent / user speaking right now" UI:
 *
 *   <VoiceMeter conv={conv} source="output" />   // agent voice
 *   <VoiceMeter conv={conv} source="input" />    // user mic
 *
 * Renders a horizontal fill bar by default. Pass `variant="vertical"` for
 * a vertical orientation. For waveform-style bars, use <VoiceWaveform>.
 */

import { useInputLevel, useOutputLevel } from '../hooks/useVoiceLevel';
import type { UseConversationResult } from '../hooks/useConversation';

export interface VoiceMeterProps {
  /** The `useConversation` / `useVoiceDuplex` result. */
  conv: UseConversationResult;
  /** Which audio stream to measure. */
  source: 'input' | 'output';
  /** Smoothing factor 0–1 (higher = smoother). Default 0.7. */
  smoothing?: number;
  /** Orientation. Default `'horizontal'`. */
  variant?: 'horizontal' | 'vertical';
  /** Active fill color. Default `currentColor`. */
  fillColor?: string;
  /** Track (background) color. Default rgba(0,0,0,0.1). */
  trackColor?: string;
  /** Container className for layout/sizing. */
  className?: string;
  /** Inline style merged into the container. */
  style?: React.CSSProperties;
}

export function VoiceMeter({
  conv,
  source,
  smoothing = 0.7,
  variant = 'horizontal',
  fillColor = 'currentColor',
  trackColor = 'rgba(0,0,0,0.1)',
  className,
  style,
}: VoiceMeterProps) {
  const inputLevel = useInputLevel(conv, { smoothing });
  const outputLevel = useOutputLevel(conv, { smoothing });
  const level = source === 'input' ? inputLevel : outputLevel;
  const pct = Math.max(0, Math.min(1, level)) * 100;

  const isVertical = variant === 'vertical';

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: trackColor,
        borderRadius: 4,
        ...style,
      }}
      role="meter"
      aria-label={`${source} audio level`}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(level.toFixed(3))}
    >
      <div
        style={{
          position: 'absolute',
          ...(isVertical
            ? { left: 0, right: 0, bottom: 0, height: `${pct}%` }
            : { top: 0, bottom: 0, left: 0, width: `${pct}%` }),
          background: fillColor,
          transition: 'width 60ms linear, height 60ms linear',
        }}
      />
    </div>
  );
}
