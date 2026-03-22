import type { STTProvider, STTRequest, STTResponse } from '../../types';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

export class DeepgramSTTProvider implements STTProvider {
  name = 'deepgram' as const;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.DEEPGRAM_API_KEY ?? '';
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const startTime = Date.now();

    const params = new URLSearchParams({
      model: 'nova-2',
      language: request.language ?? 'en',
      smart_format: 'true',
      punctuate: 'true',
      diarize: 'false',
      filler_words: 'false',
    });

    const response = await fetch(`${DEEPGRAM_API_URL}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': request.contentType ?? 'audio/webm',
      },
      body: request.audioBuffer,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Deepgram STT error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const alternative = data.results?.channels?.[0]?.alternatives?.[0];

    return {
      transcript: alternative?.transcript ?? '',
      confidence: alternative?.confidence ?? 0,
      provider: 'deepgram',
      latencyMs: Date.now() - startTime,
      isFinal: true,
    };
  }
}
