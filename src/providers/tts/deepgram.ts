import type { TTSProvider, TTSRequest, TTSResponse, TTSStreamResponse } from '../../types';

const DEEPGRAM_API_BASE = 'https://api.deepgram.com/v1';

export class DeepgramTTSProvider implements TTSProvider {
  name = 'deepgram' as const;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.DEEPGRAM_API_KEY ?? '';
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const startTime = Date.now();
    const { text, voiceProfile } = request;

    const voiceId = voiceProfile.deepgramVoiceId || 'aura-asteria-en';

    const response = await fetch(`${DEEPGRAM_API_BASE}/speak?model=${voiceId}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Deepgram TTS failed (${response.status}): ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      audioBuffer,
      contentType: 'audio/mpeg', // Deepgram returns mp3 by default
      provider: 'deepgram',
      latencyMs: Date.now() - startTime,
    };
  }

  async synthesizeStream(request: TTSRequest): Promise<TTSStreamResponse> {
    const { text, voiceProfile } = request;

    const voiceId = voiceProfile.deepgramVoiceId || 'aura-asteria-en';

    const response = await fetch(`${DEEPGRAM_API_BASE}/speak?model=${voiceId}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Deepgram TTS stream failed (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Deepgram TTS stream: response body is null');
    }

    return {
      stream: response.body,
      contentType: 'audio/mpeg',
      provider: 'deepgram',
    };
  }
}
