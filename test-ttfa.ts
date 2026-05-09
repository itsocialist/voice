import { CartesiaProvider } from './src/providers/tts/cartesia';
import { DeepgramTTSProvider } from './src/providers/tts/deepgram';
import { TTSRequest } from './src/types';

const text = "Thanks for taking the time today. I want to align on your Q3 pipeline and see if our platform can help.";

async function run() {
    console.log("Measuring TTFA...");

    const request: TTSRequest = {
        text,
        voiceProfile: {
            id: 'test', name: 'test', provider: 'cartesia',
            cartesiaVoiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',
            deepgramVoiceId: 'aura-asteria-en'
        },
        format: 'mp3'
    };

    const cartesia = new CartesiaProvider();
    if (cartesia.isAvailable()) {
        const start = Date.now();
        const res = await cartesia.synthesizeStream(request);
        const reader = res.stream.getReader();
        await reader.read();
        console.log(`Cartesia TTFA: ${Date.now() - start}ms`);
    } else {
        console.log("Cartesia not available");
    }

    const deepgram = new DeepgramTTSProvider();
    if (deepgram.isAvailable()) {
        const start = Date.now();
        const res = await deepgram.synthesizeStream(request);
        const reader = res.stream.getReader();
        await reader.read();
        console.log(`Deepgram TTFA: ${Date.now() - start}ms`);
    } else {
        console.log("Deepgram not available");
    }
}

run();
