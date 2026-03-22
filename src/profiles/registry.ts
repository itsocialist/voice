/**
 * VoiceRegistry — generic profile store.
 *
 * Apps register their own domain-specific profiles at startup.
 * The registry is then passed to route handlers and hooks.
 *
 * Example:
 *   import { voiceRegistry } from '@briandawson/voice'
 *   voiceRegistry.register('narrator', { elevenlabsVoiceId: '...', ... })
 *   const profile = voiceRegistry.resolve('narrator')   // exact match
 *   const profile = voiceRegistry.resolve('champion')   // falls back to default
 */

import type { VoiceProfile } from '../types';

// Built-in fallback — a neutral voice that works without any profile being registered.
// Uses the most common/free voice IDs for each provider.
export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  name: 'Default',
  elevenlabsVoiceId: 'EXAVITQu4vr4xnSDxMaL', // Sarah — ElevenLabs free voice
  fishModelId: '7f92f8afb8ec43bf81429cc1c9199cb1',
  openaiVoice: 'nova',
  gender: 'female',
  ageRange: 'middle',
  style: 'Neutral, clear, professional.',
  elevenlabsSettings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.3,
    use_speaker_boost: true,
  },
  fishSettings: {
    temperature: 0.7,
    top_p: 0.8,
    speed: 1.0,
  },
};

export class VoiceRegistry {
  private profiles = new Map<string, VoiceProfile>();
  private default: VoiceProfile;

  constructor(defaultProfile: VoiceProfile = DEFAULT_VOICE_PROFILE) {
    this.default = defaultProfile;
  }

  /** Register a profile under one or more keys */
  register(key: string | string[], profile: VoiceProfile): this {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      this.profiles.set(k.toLowerCase(), profile);
    }
    return this;
  }

  /** Register multiple profiles at once */
  registerAll(profiles: Record<string, VoiceProfile>): this {
    for (const [key, profile] of Object.entries(profiles)) {
      this.register(key, profile);
    }
    return this;
  }

  /**
   * Resolve a profile by key.
   *
   * Matching strategy (in order):
   *  1. Exact key match (case-insensitive)
   *  2. Partial key match (any registered key that includes the query)
   *  3. Default profile
   */
  resolve(key: string): VoiceProfile {
    const normalized = key.toLowerCase().trim();

    // Exact match
    if (this.profiles.has(normalized)) {
      return this.profiles.get(normalized)!;
    }

    // Partial match — useful when key is a full description like "Champion / Internal Advocate"
    for (const [registeredKey, profile] of this.profiles) {
      if (normalized.includes(registeredKey) || registeredKey.includes(normalized)) {
        return profile;
      }
    }

    return this.default;
  }

  has(key: string): boolean {
    return this.profiles.has(key.toLowerCase());
  }

  keys(): string[] {
    return Array.from(this.profiles.keys());
  }

  setDefault(profile: VoiceProfile): this {
    this.default = profile;
    return this;
  }

  getDefault(): VoiceProfile {
    return this.default;
  }
}

// Singleton registry — shared across the app.
// Apps call voiceRegistry.registerAll(myProfiles) at startup.
export const voiceRegistry = new VoiceRegistry();
