import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TTSProvider, TTSProviderName, TTSRequest, TTSResponse } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(
  name: TTSProviderName,
  available = true,
  failOnce = false
): TTSProvider & { callCount: number } {
  let calls = 0;
  return {
    name,
    callCount: 0,
    isAvailable: () => available,
    async synthesize(req: TTSRequest): Promise<TTSResponse> {
      calls++;
      (this as { callCount: number }).callCount = calls;
      if (failOnce && calls === 1) throw new Error(`${name} simulated failure`);
      return {
        audioBuffer: new ArrayBuffer(8),
        contentType: 'audio/mpeg',
        provider: name,
        latencyMs: 42,
      };
    },
  };
}

const MOCK_PROFILE = {
  name: 'Test',
  elevenlabsVoiceId: 'el-test',
  fishModelId: 'fish-test',
  openaiVoice: 'nova' as const,
  gender: 'female' as const,
  ageRange: 'middle' as const,
  elevenlabsSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
  fishSettings: { temperature: 0.7, top_p: 0.8, speed: 1.0 },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TTS Router', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.TTS_PROVIDER;
  });

  afterEach(() => {
    delete process.env.TTS_PROVIDER;
  });

  describe('provider resolution', () => {
    it('uses preferredProvider when it is available', async () => {
      const el = makeProvider('elevenlabs');
      const fish = makeProvider('fish');

      vi.doMock('../providers/tts/elevenlabs', () => ({ ElevenLabsProvider: vi.fn(() => el) }));
      vi.doMock('../providers/tts/fish-audio', () => ({ FishAudioProvider: vi.fn(() => fish) }));
      vi.doMock('../providers/tts/openai', () => ({ OpenAITTSProvider: vi.fn(() => makeProvider('openai', false)) }));

      const { synthesizeSpeech, resetProviders } = await import('../router/tts');
      resetProviders();

      const result = await synthesizeSpeech({
        text: 'Hello',
        voiceProfile: MOCK_PROFILE,
        preferredProvider: 'fish',
      });

      expect(result.provider).toBe('fish');
    });

    it('falls back to TTS_PROVIDER env var', async () => {
      process.env.TTS_PROVIDER = 'fish';

      const el = makeProvider('elevenlabs');
      const fish = makeProvider('fish');

      vi.doMock('../providers/tts/elevenlabs', () => ({ ElevenLabsProvider: vi.fn(() => el) }));
      vi.doMock('../providers/tts/fish-audio', () => ({ FishAudioProvider: vi.fn(() => fish) }));
      vi.doMock('../providers/tts/openai', () => ({ OpenAITTSProvider: vi.fn(() => makeProvider('openai', false)) }));

      const { synthesizeSpeech, resetProviders } = await import('../router/tts');
      resetProviders();

      const result = await synthesizeSpeech({ text: 'Hello', voiceProfile: MOCK_PROFILE });
      expect(result.provider).toBe('fish');
    });

    it('falls through fallback chain when no preference is set', async () => {
      const el = makeProvider('elevenlabs');

      vi.doMock('../providers/tts/elevenlabs', () => ({ ElevenLabsProvider: vi.fn(() => el) }));
      vi.doMock('../providers/tts/fish-audio', () => ({ FishAudioProvider: vi.fn(() => makeProvider('fish', false)) }));
      vi.doMock('../providers/tts/openai', () => ({ OpenAITTSProvider: vi.fn(() => makeProvider('openai', false)) }));

      const { synthesizeSpeech, resetProviders } = await import('../router/tts');
      resetProviders();

      const result = await synthesizeSpeech({ text: 'Hello', voiceProfile: MOCK_PROFILE });
      expect(result.provider).toBe('elevenlabs');
    });

    it('throws when no provider is available', async () => {
      vi.doMock('../providers/tts/elevenlabs', () => ({ ElevenLabsProvider: vi.fn(() => makeProvider('elevenlabs', false)) }));
      vi.doMock('../providers/tts/fish-audio', () => ({ FishAudioProvider: vi.fn(() => makeProvider('fish', false)) }));
      vi.doMock('../providers/tts/openai', () => ({ OpenAITTSProvider: vi.fn(() => makeProvider('openai', false)) }));

      const { synthesizeSpeech, resetProviders } = await import('../router/tts');
      resetProviders();

      await expect(synthesizeSpeech({ text: 'Hello', voiceProfile: MOCK_PROFILE })).rejects.toThrow(
        /No TTS provider available/
      );
    });
  });

  describe('automatic fallback', () => {
    it('falls back to next provider when primary fails', async () => {
      const el = makeProvider('elevenlabs', true, true); // fails on first call
      const fish = makeProvider('fish');

      vi.doMock('../providers/tts/elevenlabs', () => ({ ElevenLabsProvider: vi.fn(() => el) }));
      vi.doMock('../providers/tts/fish-audio', () => ({ FishAudioProvider: vi.fn(() => fish) }));
      vi.doMock('../providers/tts/openai', () => ({ OpenAITTSProvider: vi.fn(() => makeProvider('openai', false)) }));

      const { synthesizeSpeech, resetProviders } = await import('../router/tts');
      resetProviders();

      const result = await synthesizeSpeech({ text: 'Hello', voiceProfile: MOCK_PROFILE });
      expect(result.provider).toBe('fish');
    });

    it('throws after all providers fail', async () => {
      const el = makeProvider('elevenlabs', true, true);
      const fish = makeProvider('fish', true, true);
      const oai = makeProvider('openai', true, true);

      vi.doMock('../providers/tts/elevenlabs', () => ({ ElevenLabsProvider: vi.fn(() => el) }));
      vi.doMock('../providers/tts/fish-audio', () => ({ FishAudioProvider: vi.fn(() => fish) }));
      vi.doMock('../providers/tts/openai', () => ({ OpenAITTSProvider: vi.fn(() => oai) }));

      const { synthesizeSpeech, resetProviders } = await import('../router/tts');
      resetProviders();

      await expect(synthesizeSpeech({ text: 'Hello', voiceProfile: MOCK_PROFILE })).rejects.toThrow();
    });
  });

  describe('getProviderStatus', () => {
    it('returns correct status shape', async () => {
      const el = makeProvider('elevenlabs');

      vi.doMock('../providers/tts/elevenlabs', () => ({ ElevenLabsProvider: vi.fn(() => el) }));
      vi.doMock('../providers/tts/fish-audio', () => ({ FishAudioProvider: vi.fn(() => makeProvider('fish', false)) }));
      vi.doMock('../providers/tts/openai', () => ({ OpenAITTSProvider: vi.fn(() => makeProvider('openai', false)) }));

      const { getProviderStatus, resetProviders } = await import('../router/tts');
      resetProviders();

      const status = getProviderStatus();
      expect(status.primary).toBe('elevenlabs');
      expect(status.available).toContain('elevenlabs');
      expect(status.fallbacks).not.toContain('elevenlabs');
    });
  });
});
