#!/usr/bin/env node
/**
 * check-providers.ts — Live provider integration check
 *
 * Calls each configured TTS provider with a short test phrase,
 * reports latency, saves sample audio files, and summarizes what is working.
 *
 * Usage:
 *   # Set your API keys first
 *   export ELEVENLABS_API_KEY=...
 *   export FISH_AUDIO_API_KEY=...
 *   export OPENAI_API_KEY=...
 *
 *   npx tsx scripts/check-providers.ts
 *
 * Output files: ./tmp/sample-<provider>.mp3
 */

import fs from 'fs';
import path from 'path';
import { ElevenLabsProvider } from '../src/providers/tts/elevenlabs';
import { FishAudioProvider } from '../src/providers/tts/fish-audio';
import { OpenAITTSProvider } from '../src/providers/tts/openai';
import { DeepgramSTTProvider } from '../src/providers/stt/deepgram';
import type { VoiceProfile } from '../src/types';

// ─── Test profile (uses known public voice IDs) ───────────────────────────────

const TEST_PROFILE: VoiceProfile = {
  name: 'Check Voice',
  elevenlabsVoiceId: 'EXAVITQu4vr4xnSDxMaL', // ElevenLabs "Sarah" — free/public
  fishModelId: process.env.FISH_TEST_MODEL_ID ?? 'YOUR_FISH_MODEL_ID',
  openaiVoice: 'nova',
  gender: 'female',
  ageRange: 'middle',
  elevenlabsSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false },
  fishSettings: { temperature: 0.7, top_p: 0.8, speed: 1.0 },
};

const TEST_TEXT = 'Voice library provider check. One two three.';

const OUT_DIR = path.join(process.cwd(), 'tmp');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ok(msg: string) { console.log(`  ✓  ${msg}`); }
function fail(msg: string) { console.log(`  ✗  ${msg}`); }
function info(msg: string) { console.log(`     ${msg}`); }
function section(title: string) { console.log(`\n── ${title} ──`); }

function saveAudio(name: string, buffer: ArrayBuffer) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `sample-${name}.mp3`);
  fs.writeFileSync(outPath, Buffer.from(buffer));
  return outPath;
}

// ─── TTS Checks ──────────────────────────────────────────────────────────────

async function checkElevenLabs() {
  section('ElevenLabs TTS');
  const provider = new ElevenLabsProvider();

  if (!provider.isAvailable()) {
    fail('ELEVENLABS_API_KEY not set — skipping');
    return;
  }

  try {
    const start = Date.now();
    const result = await provider.synthesize({ text: TEST_TEXT, voiceProfile: TEST_PROFILE });
    const ms = Date.now() - start;
    const outPath = saveAudio('elevenlabs', result.audioBuffer);
    ok(`Synthesized ${result.audioBuffer.byteLength} bytes in ${ms}ms`);
    info(`Saved: ${outPath}`);
    info(`Content-Type: ${result.contentType}`);
  } catch (err) {
    fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkFishAudio() {
  section('Fish Audio TTS');
  const provider = new FishAudioProvider();

  if (!provider.isAvailable()) {
    fail('FISH_AUDIO_API_KEY not set — skipping');
    return;
  }

  if (TEST_PROFILE.fishModelId === 'YOUR_FISH_MODEL_ID') {
    fail('Set FISH_TEST_MODEL_ID env var to a real Fish Audio reference model ID');
    return;
  }

  try {
    const start = Date.now();
    const result = await provider.synthesize({ text: TEST_TEXT, voiceProfile: TEST_PROFILE });
    const ms = Date.now() - start;
    const outPath = saveAudio('fish', result.audioBuffer);
    ok(`Synthesized ${result.audioBuffer.byteLength} bytes in ${ms}ms`);
    info(`Saved: ${outPath}`);
  } catch (err) {
    fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkOpenAI() {
  section('OpenAI TTS');
  const provider = new OpenAITTSProvider();

  if (!provider.isAvailable()) {
    fail('OPENAI_API_KEY not set — skipping');
    return;
  }

  try {
    const start = Date.now();
    const result = await provider.synthesize({ text: TEST_TEXT, voiceProfile: TEST_PROFILE });
    const ms = Date.now() - start;
    const outPath = saveAudio('openai', result.audioBuffer);
    ok(`Synthesized ${result.audioBuffer.byteLength} bytes in ${ms}ms`);
    info(`Saved: ${outPath}`);
  } catch (err) {
    fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── STT Check ───────────────────────────────────────────────────────────────

async function checkDeepgram() {
  section('Deepgram STT');
  const provider = new DeepgramSTTProvider();

  if (!provider.isAvailable()) {
    fail('DEEPGRAM_API_KEY not set — skipping');
    return;
  }

  // Use the ElevenLabs sample if it exists, otherwise generate a tiny silent WAV
  const samplePath = path.join(OUT_DIR, 'sample-elevenlabs.mp3');
  if (!fs.existsSync(samplePath)) {
    info('No sample audio found (run ElevenLabs check first). Skipping STT test.');
    return;
  }

  try {
    const audioBuffer = fs.readFileSync(samplePath).buffer as ArrayBuffer;
    const start = Date.now();
    const result = await provider.transcribe({ audioBuffer, contentType: 'audio/mpeg' });
    const ms = Date.now() - start;
    ok(`Transcribed in ${ms}ms — confidence: ${(result.confidence * 100).toFixed(0)}%`);
    info(`Transcript: "${result.transcript}"`);
  } catch (err) {
    fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

async function checkConvAIConfig() {
  section('ConvAI / ElevenLabs Agent API');
  if (!process.env.ELEVENLABS_API_KEY) {
    fail('ELEVENLABS_API_KEY not set — skipping ConvAI check');
    return;
  }
  info('ConvAI requires a full browser session (WebRTC/WebSocket).');
  info('Use the live ConvAI test in your Next.js app instead.');
  info('Tip: add ?debug=1 to your app URL to enable verbose ConvAI logging.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════');
console.log('  @itsocialist/voice — Provider Check  ');
console.log('═══════════════════════════════════════');
info(`Date: ${new Date().toISOString()}`);
info(`Node: ${process.version}`);

await checkElevenLabs();
await checkFishAudio();
await checkOpenAI();
await checkDeepgram();
await checkConvAIConfig();

console.log('\n═══════════════════════════════════════');
console.log('  Done. Check ./tmp/ for audio samples.');
console.log('═══════════════════════════════════════\n');
