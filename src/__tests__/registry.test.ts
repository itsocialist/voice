import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceRegistry, DEFAULT_VOICE_PROFILE } from '../profiles/registry';
import type { VoiceProfile } from '../types';

// Minimal test profile factory
function makeProfile(name: string): VoiceProfile {
  return {
    name,
    elevenlabsVoiceId: `el-${name}`,
    fishModelId: `fish-${name}`,
    openaiVoice: 'nova',
    gender: 'female',
    ageRange: 'middle',
    elevenlabsSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
    fishSettings: { temperature: 0.7, top_p: 0.8, speed: 1.0 },
  };
}

const narrator = makeProfile('Narrator');
const coach = makeProfile('Coach');
const executive = makeProfile('Executive');

describe('VoiceRegistry', () => {
  let registry: VoiceRegistry;

  beforeEach(() => {
    registry = new VoiceRegistry();
  });

  describe('register / resolve — exact match', () => {
    it('resolves a registered profile by key', () => {
      registry.register('narrator', narrator);
      expect(registry.resolve('narrator')).toBe(narrator);
    });

    it('is case-insensitive', () => {
      registry.register('Narrator', narrator);
      expect(registry.resolve('NARRATOR')).toBe(narrator);
      expect(registry.resolve('narrator')).toBe(narrator);
    });

    it('allows re-registering under the same key', () => {
      registry.register('narrator', narrator);
      registry.register('narrator', coach);
      expect(registry.resolve('narrator')).toBe(coach);
    });
  });

  describe('register — multiple keys', () => {
    it('registers a profile under several keys at once', () => {
      registry.register(['cfo', 'executive', 'finance'], executive);
      expect(registry.resolve('cfo')).toBe(executive);
      expect(registry.resolve('executive')).toBe(executive);
      expect(registry.resolve('finance')).toBe(executive);
    });
  });

  describe('registerAll', () => {
    it('registers a record of profiles', () => {
      registry.registerAll({ narrator, coach, executive });
      expect(registry.resolve('narrator')).toBe(narrator);
      expect(registry.resolve('coach')).toBe(coach);
      expect(registry.resolve('executive')).toBe(executive);
    });
  });

  describe('resolve — partial / fuzzy match', () => {
    it('resolves when the query contains a registered key', () => {
      registry.register('champion', executive);
      expect(registry.resolve('Champion / Internal Advocate')).toBe(executive);
    });

    it('resolves when a registered key contains the query', () => {
      registry.register('senior-coach', coach);
      expect(registry.resolve('coach')).toBe(coach);
    });
  });

  describe('resolve — fallback to default', () => {
    it('returns the default profile for unknown keys', () => {
      expect(registry.resolve('unknown-voice')).toBe(DEFAULT_VOICE_PROFILE);
    });

    it('returns a custom default when one is set', () => {
      const customDefault = makeProfile('Custom Default');
      registry.setDefault(customDefault);
      expect(registry.resolve('unknown')).toBe(customDefault);
    });
  });

  describe('has', () => {
    it('returns true for registered keys', () => {
      registry.register('narrator', narrator);
      expect(registry.has('narrator')).toBe(true);
      expect(registry.has('NARRATOR')).toBe(true);
    });

    it('returns false for unregistered keys', () => {
      expect(registry.has('narrator')).toBe(false);
    });
  });

  describe('keys', () => {
    it('returns all registered keys', () => {
      registry.registerAll({ narrator, coach });
      const keys = registry.keys();
      expect(keys).toContain('narrator');
      expect(keys).toContain('coach');
      expect(keys).toHaveLength(2);
    });
  });

  describe('getDefault', () => {
    it('returns the default profile', () => {
      expect(registry.getDefault()).toBe(DEFAULT_VOICE_PROFILE);
    });
  });

  describe('constructor custom default', () => {
    it('uses the provided default profile', () => {
      const customDefault = makeProfile('Custom');
      const r = new VoiceRegistry(customDefault);
      expect(r.resolve('anything')).toBe(customDefault);
    });
  });
});
