import type { TTSProvider, TTSRequest, TTSResponse } from '../../types';

const FISH_API_BASE = 'https://api.fish.audio/v1';

export class FishAudioProvider implements TTSProvider {
  name = 'fish' as const;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.FISH_AUDIO_API_KEY ?? '';
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    const { text, voiceProfile, format = 'mp3' } = request;
    const settings = voiceProfile.fishSettings;

    const response = await fetch(`${FISH_API_BASE}/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        reference_id: voiceProfile.fishModelId,
        format,
        temperature: settings.temperature,
        top_p: settings.top_p,
        prosody: {
          speed: settings.speed,
          volume: 1.0,
        },
        chunk_length: 200,
        normalize: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Fish Audio TTS failed (${response.status}): ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      audioBuffer,
      contentType: `audio/${format === 'mp3' ? 'mpeg' : format}`,
      provider: 'fish',
      latencyMs: Date.now() - startTime,
    };
  }
}
