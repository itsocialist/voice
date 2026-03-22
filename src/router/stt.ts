/**
 * STT Provider Router
 *
 * Server-side: Deepgram (Nova-2) when DEEPGRAM_API_KEY is set.
 * Client-side: Web Speech API — handled directly in VoiceInput component.
 */

import type { STTProvider, STTRequest, STTResponse, STTProviderStatus } from '../types';
import { DeepgramSTTProvider } from '../providers/stt/deepgram';

const deepgram = new DeepgramSTTProvider();
const serverProviders: STTProvider[] = [deepgram];

function getPreferredProvider(): STTProvider | null {
  const preferred = process.env.STT_PROVIDER ?? 'deepgram';
  return (
    serverProviders.find((p) => p.name === preferred && p.isAvailable()) ??
    serverProviders.find((p) => p.isAvailable()) ??
    null
  );
}

export async function transcribeAudio(request: STTRequest): Promise<STTResponse> {
  const provider = getPreferredProvider();
  if (!provider) {
    throw new Error('No STT provider available. Set DEEPGRAM_API_KEY in your environment.');
  }
  return provider.transcribe(request);
}

export function getSTTStatus(): STTProviderStatus {
  return {
    primary: getPreferredProvider()?.name ?? 'none',
    available: serverProviders.filter((p) => p.isAvailable()).map((p) => p.name),
    clientSide: ['webspeech'],
    note: 'Web Speech API runs client-side (free, no key). Deepgram runs server-side (higher accuracy).',
  };
}
