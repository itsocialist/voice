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
    
    // Generate context ID for continuation
    const contextId = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2);

    let ws: WebSocket;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?api_key=${this.apiKey}&cartesia_version=${this.cartesiaVersion}`);
        
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          ws.send(JSON.stringify({
            context_id: contextId,
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
          }));
        };

        ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            if (data.type === 'done') {
              ws.close();
              controller.close();
            } else if (data.type === 'error') {
              controller.error(new Error(`Cartesia WS error: ${data.error}`));
              ws.close();
            }
          } else if (event.data instanceof ArrayBuffer) {
            controller.enqueue(new Uint8Array(event.data));
          }
        };

        ws.onerror = (e) => {
          controller.error(new Error('Cartesia WebSocket Error'));
        };

        ws.onclose = () => {
          // ensure controller is closed if not already
          try { controller.close(); } catch (e) {}
        };
      },
      cancel() {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }
    });

    return {
      stream,
      contentType: 'audio/mpeg',
      provider: 'cartesia',
    };
  }
}
