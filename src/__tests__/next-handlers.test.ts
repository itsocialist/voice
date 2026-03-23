import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceRegistry } from '../profiles/registry';
import type { VoiceProfile, TTSProviderName } from '../types';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const PROFILE: VoiceProfile = {
  name: 'Test Voice',
  elevenlabsVoiceId: 'el-test',
  fishModelId: 'fish-test',
  openaiVoice: 'nova',
  gender: 'female',
  ageRange: 'middle',
  elevenlabsSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
  fishSettings: { temperature: 0.7, top_p: 0.8, speed: 1.0 },
};

function makeRequest(body: object, method = 'POST') {
  return {
    json: async () => body,
    method,
  } as unknown as import('next/server').NextRequest;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ─── TTS Handler ─────────────────────────────────────────────────────────────

describe('TTS Route Handler', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 400 when text is missing', async () => {
    vi.doMock('../router/tts', () => ({
      synthesizeSpeech: vi.fn(),
      getProviderStatus: vi.fn(() => ({ primary: 'elevenlabs', available: ['elevenlabs'], fallbacks: [] })),
      resetProviders: vi.fn(),
    }));

    const { createTTSHandler } = await import('../../next/tts-handler');
    const { POST } = createTTSHandler();
    const res = await POST(makeRequest({ text: '' }));
    expect(res.status).toBe(400);
    const body = await readBody(res);
    expect((body as { error: string }).error).toMatch(/text is required/);
  });

  it('returns browser TTS signal when provider=browser', async () => {
    vi.doMock('../router/tts', () => ({
      synthesizeSpeech: vi.fn(),
      getProviderStatus: vi.fn(),
      resetProviders: vi.fn(),
    }));

    const { createTTSHandler } = await import('../../next/tts-handler');
    const { POST } = createTTSHandler();
    const res = await POST(makeRequest({ text: 'Say this', provider: 'browser' }));
    expect(res.status).toBe(200);
    const body = await readBody(res) as { useBrowserTTS: boolean; text: string };
    expect(body.useBrowserTTS).toBe(true);
    expect(body.text).toBe('Say this');
  });

  it('calls synthesizeSpeech and returns audio', async () => {
    const mockBuffer = new ArrayBuffer(16);
    const mockSynthesize = vi.fn().mockResolvedValue({
      audioBuffer: mockBuffer,
      contentType: 'audio/mpeg',
      provider: 'elevenlabs' as TTSProviderName,
      latencyMs: 99,
    });

    vi.doMock('../router/tts', () => ({
      synthesizeSpeech: mockSynthesize,
      getProviderStatus: vi.fn(),
      resetProviders: vi.fn(),
    }));

    const registry = new VoiceRegistry();
    registry.register('test', PROFILE);

    const { createTTSHandler } = await import('../../next/tts-handler');
    const { POST } = createTTSHandler({ registry });
    const res = await POST(makeRequest({ text: 'Hello world', profileKey: 'test' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-TTS-Provider')).toBe('elevenlabs');
    expect(res.headers.get('X-TTS-Latency-Ms')).toBe('99');
    expect(res.headers.get('X-Voice-Name')).toBe('Test Voice');
    expect(mockSynthesize).toHaveBeenCalledOnce();
  });

  it('resolves explicit voiceProfile when provided', async () => {
    const mockSynthesize = vi.fn().mockResolvedValue({
      audioBuffer: new ArrayBuffer(4),
      contentType: 'audio/mpeg',
      provider: 'elevenlabs' as TTSProviderName,
      latencyMs: 10,
    });

    vi.doMock('../router/tts', () => ({
      synthesizeSpeech: mockSynthesize,
      getProviderStatus: vi.fn(),
      resetProviders: vi.fn(),
    }));

    const { createTTSHandler } = await import('../../next/tts-handler');
    const { POST } = createTTSHandler();
    await POST(makeRequest({ text: 'Hello', voiceProfile: PROFILE }));

    expect(mockSynthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voiceProfile: PROFILE })
    );
  });

  it('GET returns provider status', async () => {
    const mockStatus = { primary: 'fish', available: ['fish'], fallbacks: [] };
    vi.doMock('../router/tts', () => ({
      synthesizeSpeech: vi.fn(),
      getProviderStatus: vi.fn(() => mockStatus),
      resetProviders: vi.fn(),
    }));

    const { createTTSHandler } = await import('../../next/tts-handler');
    const { GET } = createTTSHandler();
    const res = await GET();
    const body = await readBody(res);
    expect(body).toEqual(mockStatus);
  });

  it('returns 500 on synthesizeSpeech error', async () => {
    vi.doMock('../router/tts', () => ({
      synthesizeSpeech: vi.fn().mockRejectedValue(new Error('All providers failed')),
      getProviderStatus: vi.fn(),
      resetProviders: vi.fn(),
    }));

    const { createTTSHandler } = await import('../../next/tts-handler');
    const { POST } = createTTSHandler();
    const res = await POST(makeRequest({ text: 'Hello world' }));
    expect(res.status).toBe(500);
    const body = await readBody(res) as { error: string };
    expect(body.error).toMatch(/All providers failed/);
  });
});
