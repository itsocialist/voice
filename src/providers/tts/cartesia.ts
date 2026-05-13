import type { TTSProvider, TTSRequest, TTSResponse } from '../../types';

export class CartesiaProvider implements TTSProvider {
  name = 'cartesia' as const;
  /**
   * v0.3.2: marked `false` because `/tts/bytes` (the endpoint this provider
   * currently hits) is buffered — it generates the full audio server-side
   * then returns it as a single HTTP response. Cartesia's real streaming
   * endpoints (`/tts/websocket`, `/tts/sse`) aren't wired up yet. The router
   * honors this flag and, when streaming is requested, falls back to
   * `synthesize()` wrapped in a one-chunk ReadableStream with a clear warning.
   */
  supportsStreaming = false as const;
  private apiKey: string;
  private cartesiaVersion = '2024-06-10';

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

  // synthesizeStream removed in v0.3.2 — the previous implementation hit the
  // same buffered `/tts/bytes` endpoint as synthesize() and returned the
  // response body, which gave the appearance of streaming without the
  // incremental delivery. The router falls back to wrapping synthesize()
  // output and emits a clear warning when streaming is requested but no
  // streaming-capable provider is selected. Real Cartesia streaming will
  // come via the WebSocket / SSE endpoint in a future release.
}
