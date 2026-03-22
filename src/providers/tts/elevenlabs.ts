import type { TTSProvider, TTSRequest, TTSResponse } from '../../types';

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

export class ElevenLabsProvider implements TTSProvider {
  name = 'elevenlabs' as const;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ELEVENLABS_API_KEY ?? '';
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    const { text, voiceProfile, format = 'mp3' } = request;

    const voiceId = voiceProfile.elevenlabsVoiceId;
    const settings = voiceProfile.elevenlabsSettings;

    // eleven_v3 for dialog quality; turbo for long responses where latency matters
    const modelId = text.length > 800 ? 'eleven_turbo_v2_5' : 'eleven_v3';
    // Latency optimization level 2 = ~75% improvement for short responses
    const optimizeLatency = text.length < 300 ? 2 : 1;

    const response = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}?optimize_streaming_latency=${optimizeLatency}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: `audio/${format}`,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          output_format: format === 'mp3' ? 'mp3_44100_128' : format,
          voice_settings: {
            stability: settings.stability,
            similarity_boost: settings.similarity_boost,
            style: settings.style,
            use_speaker_boost: settings.use_speaker_boost,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      audioBuffer,
      contentType: `audio/${format === 'mp3' ? 'mpeg' : format}`,
      provider: 'elevenlabs',
      latencyMs: Date.now() - startTime,
    };
  }
}
