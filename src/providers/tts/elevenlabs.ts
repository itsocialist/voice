import type { TTSProvider, TTSRequest, TTSResponse, TTSStreamResponse } from '../../types';

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

  /**
   * synthesizeStream() — S7-TECH-05
   *
   * Uses Flash v2.5 (/stream endpoint) to return audio chunks as they arrive.
   * First chunk arrives in ~75ms vs ~2.3s for buffered synthesize().
   * Use this for chat-mode TTS where perceived latency matters.
   *
   * The caller pipes the ReadableStream directly into a Response:
   *   return new Response(result.stream, { headers: { 'Content-Type': result.contentType } });
   */
  async synthesizeStream(request: TTSRequest): Promise<TTSStreamResponse> {
    const { text, voiceProfile, format = 'mp3' } = request;

    const voiceId = voiceProfile.elevenlabsVoiceId;
    const settings = voiceProfile.elevenlabsSettings;

    // Flash v2.5: lowest latency model on the streaming endpoint
    // ~75ms TTFA vs ~2.3s for buffered synthesize()
    const modelId = 'eleven_flash_v2_5';

    const response = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}/stream`,
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
      throw new Error(`ElevenLabs TTS stream failed (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('ElevenLabs TTS stream: response body is null');
    }

    return {
      stream: response.body,
      contentType: `audio/${format === 'mp3' ? 'mpeg' : format}`,
      provider: 'elevenlabs',
    };
  }
}
