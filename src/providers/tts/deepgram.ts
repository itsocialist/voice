import type { TTSProvider, TTSRequest, TTSResponse } from '../../types';

const DEEPGRAM_API_BASE = 'https://api.deepgram.com/v1';

export class DeepgramTTSProvider implements TTSProvider {
  name = 'deepgram' as const;
  /**
   * v0.3.2: marked `false` because the previous `synthesizeStream` hit the
   * same buffered `/v1/speak` endpoint as `synthesize()` and returned the
   * response body — appearance of streaming without incremental delivery.
   * Deepgram's true streaming TTS is over WebSocket and isn't wired up
   * here yet. Router falls back to a clearly-warned buffered wrap when
   * streaming is requested.
   */
  supportsStreaming = false as const;
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

  // synthesizeStream removed in v0.3.2 — see CartesiaProvider for the
  // rationale. WebSocket TTS streaming will come in a future release.
}
