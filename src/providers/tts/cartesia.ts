import type { TTSProvider, TTSRequest, TTSResponse, TTSStreamResponse } from '../../types';

export class CartesiaProvider implements TTSProvider {
  name = 'cartesia' as const;
  private apiKey: string;
  private cartesiaVersion = '2024-06-10'; // or appropriate version

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.CARTESIA_API_KEY ?? '';
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    const { text, voiceProfile } = request;

    const voiceId = voiceProfile.cartesiaVoiceId || 'a0e99841-438c-4a64-b679-ae501e7d6091'; // fallback

    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': this.cartesiaVersion,
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'sonic-english',
        transcript: text,
        voice: {
          mode: 'id',
          id: voiceId,
        },
        output_format: {
          container: 'mp3',
          encoding: 'mp3',
          sample_rate: 44100,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Cartesia TTS failed (${response.status}): ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      audioBuffer,
      contentType: 'audio/mpeg',
      provider: 'cartesia',
      latencyMs: Date.now() - startTime,
    };
  }

  async synthesizeStream(request: TTSRequest): Promise<TTSStreamResponse> {
    const { text, voiceProfile } = request;
    const voiceId = voiceProfile.cartesiaVoiceId || 'a0e99841-438c-4a64-b679-ae501e7d6091';

    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': this.cartesiaVersion,
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'sonic-english',
        transcript: text,
        voice: {
          mode: 'id',
          id: voiceId,
        },
        output_format: {
          container: request.format === 'mp3' ? 'mp3' : 'raw',
          encoding: request.format === 'mp3' ? 'mp3' : 'pcm_f32le',
          sample_rate: 44100,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Cartesia TTS stream failed (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Cartesia TTS stream: response body is null');
    }

    return {
      stream: response.body,
      contentType: request.format === 'mp3' ? 'audio/mpeg' : 'audio/pcm',
      provider: 'cartesia',
    };
  }
}
