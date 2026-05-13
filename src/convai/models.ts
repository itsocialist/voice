/**
 * ElevenLabs ConvAI TTS model identifiers.
 *
 * Typed presets so consumers can write
 *
 *   createConvAIAgent({ modelId: ELEVENLABS_MODELS.FLASH_V2_5, ... })
 *
 * instead of memorising magic strings. `modelId` remains `string` on
 * `ConvAIAgentConfig` — these constants narrow autocomplete without
 * locking the type. Pass any other model identifier ElevenLabs supports.
 *
 * Latency / expressiveness tradeoffs (May 2026):
 * - V3_CONVERSATIONAL — most expressive (audio tags, emotional cues),
 *   per-turn TTFA ~2–5s. ElevenLabs' own docs note v3 is "not suitable
 *   for real-time" — pick this when human-likeness > latency.
 * - FLASH_V2_5 — realtime tier, ~75ms inference TTFA. Loses v3's
 *   expressive audio tags. Pick when latency > human-likeness.
 * - TURBO_V2_5 — middle ground, pre-v3 quality, faster than v3.
 *
 * See CHANGELOG v0.2.3 for the introduction of these presets.
 */
export const ELEVENLABS_MODELS = {
  V3_CONVERSATIONAL: 'eleven_v3_conversational',
  FLASH_V2_5: 'eleven_flash_v2_5',
  TURBO_V2_5: 'eleven_turbo_v2_5',
  FLASH_V2: 'eleven_flash_v2',
  TURBO_V2: 'eleven_turbo_v2',
} as const;

export type ElevenLabsModelId = typeof ELEVENLABS_MODELS[keyof typeof ELEVENLABS_MODELS];
