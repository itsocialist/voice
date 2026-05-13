'use client';

/**
 * Voice visualization hooks (v0.4.2+).
 *
 * Turns the raw `Uint8Array` byte-frequency data exposed by `useConversation`
 * / `useVoiceDuplex` into shapes that drive a UI:
 *
 *   useInputLevel(conv)        → number 0–1 (smoothed RMS volume of mic)
 *   useOutputLevel(conv)       → number 0–1 (smoothed RMS volume of agent)
 *   useInputBands(conv, count) → Float32Array(count) of 0–1 log-spaced bands
 *   useOutputBands(conv, count) → Float32Array(count) of 0–1 log-spaced bands
 *
 * Each hook drives its own `requestAnimationFrame` loop, only while
 * mounted. The loop reads `conv.getInputByteFrequencyData?.()` /
 * `getOutputByteFrequencyData?.()` and applies exponential smoothing so
 * the values don't jitter frame-to-frame.
 *
 * The bands are log-spaced (perceptually meaningful for human hearing) and
 * range from 100 Hz to ~8 kHz — the SDK's analyser focuses on the human
 * voice range. Each band is a normalized 0–1 mean of the bins it covers.
 *
 * Filed in response to SpeakerHero 2026-05-13 — the raw
 * `getInputByteFrequencyData` primitive was too low-level for app authors
 * to build waveform UIs on top of without painful manual rAF wiring.
 */

import { useEffect, useRef, useState } from 'react';
import type { UseConversationResult } from './useConversation';

const DEFAULT_SMOOTHING = 0.7;
const FREQUENCY_BIN_COUNT = 1024;

/**
 * RMS of the byte-frequency data, normalized to 0–1.
 * Roughly tracks perceived loudness, less jittery than peak.
 */
function computeRMSVolume(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / bytes.length) / 255;
}

/**
 * Aggregate raw byte-frequency bins into N log-spaced bands. Bin 0 (DC)
 * is skipped. The log spacing matches what human ears actually resolve,
 * so adjacent bands have similar perceptual loudness contrast.
 */
function aggregateBandsLog(bytes: Uint8Array, count: number, out: Float32Array): void {
  if (out.length !== count) return; // defensive
  const totalBins = bytes.length;
  if (totalBins === 0) {
    out.fill(0);
    return;
  }
  const minBin = 1;
  const logMin = Math.log(minBin);
  const logMax = Math.log(totalBins);
  for (let i = 0; i < count; i++) {
    const startBin = Math.floor(Math.exp(logMin + (i / count) * (logMax - logMin)));
    const endBin = Math.floor(Math.exp(logMin + ((i + 1) / count) * (logMax - logMin)));
    const span = Math.max(1, endBin - startBin);
    let sum = 0;
    let counted = 0;
    for (let b = startBin; b < endBin && b < totalBins; b++) {
      sum += bytes[b];
      counted++;
    }
    out[i] = counted > 0 ? (sum / counted) / 255 : 0;
  }
}

type Source = 'input' | 'output';

function pickByteFreqGetter(
  conv: UseConversationResult,
  source: Source,
): (() => Uint8Array) | undefined {
  return source === 'input'
    ? conv.getInputByteFrequencyData
    : conv.getOutputByteFrequencyData;
}

function useByteFreqLoop(
  conv: UseConversationResult,
  source: Source,
  onFrame: (bytes: Uint8Array) => void,
): void {
  // Stable buffer across frames — allocated once per loop, reused.
  const bufferRef = useRef<Uint8Array | null>(null);
  if (bufferRef.current === null) {
    bufferRef.current = new Uint8Array(FREQUENCY_BIN_COUNT);
  }
  const getter = pickByteFreqGetter(conv, source);

  useEffect(() => {
    if (!getter) return;
    let rafId = 0;
    const tick = () => {
      try {
        const fresh = getter();
        if (fresh && fresh.length > 0) {
          onFrame(fresh);
        }
      } catch {
        // Analyser may not be ready before session starts — ignore.
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // Intentionally omitting onFrame — caller passes a stable closure or
    // re-runs the effect themselves. Re-subscribing the rAF loop on every
    // render would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getter]);
}

/**
 * 0–1 RMS volume of the microphone input, smoothed across frames.
 * Returns 0 when no session is active.
 */
export function useInputLevel(
  conv: UseConversationResult,
  options: { smoothing?: number } = {},
): number {
  return useLevel(conv, 'input', options.smoothing ?? DEFAULT_SMOOTHING);
}

/**
 * 0–1 RMS volume of the agent's audio output, smoothed across frames.
 * Returns 0 when no session is active or no audio is playing.
 */
export function useOutputLevel(
  conv: UseConversationResult,
  options: { smoothing?: number } = {},
): number {
  return useLevel(conv, 'output', options.smoothing ?? DEFAULT_SMOOTHING);
}

function useLevel(
  conv: UseConversationResult,
  source: Source,
  smoothing: number,
): number {
  const [level, setLevel] = useState(0);
  const smoothedRef = useRef(0);

  useByteFreqLoop(conv, source, (bytes) => {
    const raw = computeRMSVolume(bytes);
    const smoothed = smoothedRef.current * smoothing + raw * (1 - smoothing);
    smoothedRef.current = smoothed;
    setLevel(smoothed);
  });

  return level;
}

/**
 * Float32Array of `count` 0–1 normalized band magnitudes, log-spaced
 * across the 100 Hz – 8 kHz human-voice range. Updates on rAF.
 *
 * Use with a bar-chart UI:
 *
 *   const bands = useInputBands(conv, 24);
 *   return (
 *     <div className="flex h-32 gap-px">
 *       {Array.from(bands).map((v, i) => (
 *         <div key={i} style={{ height: `${v * 100}%`, flex: 1, background: '#888' }} />
 *       ))}
 *     </div>
 *   );
 */
export function useInputBands(
  conv: UseConversationResult,
  count: number,
  options: { smoothing?: number } = {},
): Float32Array {
  return useBands(conv, 'input', count, options.smoothing ?? DEFAULT_SMOOTHING);
}

/** Output (agent audio) version of `useInputBands`. */
export function useOutputBands(
  conv: UseConversationResult,
  count: number,
  options: { smoothing?: number } = {},
): Float32Array {
  return useBands(conv, 'output', count, options.smoothing ?? DEFAULT_SMOOTHING);
}

function useBands(
  conv: UseConversationResult,
  source: Source,
  count: number,
  smoothing: number,
): Float32Array {
  const [bands, setBands] = useState<Float32Array>(() => new Float32Array(count));
  // Smoothed working buffer; one for accumulation, swap with the state buffer
  // to avoid mutating React state in place.
  const workingRef = useRef<Float32Array>(new Float32Array(count));
  const rawRef = useRef<Float32Array>(new Float32Array(count));

  // Resize buffers if count changes
  useEffect(() => {
    if (workingRef.current.length !== count) {
      workingRef.current = new Float32Array(count);
      rawRef.current = new Float32Array(count);
      setBands(new Float32Array(count));
    }
  }, [count]);

  useByteFreqLoop(conv, source, (bytes) => {
    aggregateBandsLog(bytes, count, rawRef.current);
    const working = workingRef.current;
    for (let i = 0; i < count; i++) {
      working[i] = working[i] * smoothing + rawRef.current[i] * (1 - smoothing);
    }
    // Allocate a fresh buffer for React state so re-renders see new identity.
    // Slight GC cost; trades CPU for code simplicity. ~16ms/frame budget on
    // modern hardware can spare ~1µs for a small array copy.
    const next = new Float32Array(working);
    setBands(next);
  });

  return bands;
}
