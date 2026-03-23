# @itsocialist/voice

A multi-provider voice library for Next.js apps. One unified API for text-to-speech, speech-to-text, and real-time conversational AI — swap providers without rewriting your app.

```
TTS:  ElevenLabs · Fish Audio · OpenAI · Browser Web Speech
STT:  Deepgram · Browser Web Speech
ConvAI: ElevenLabs ConvAI (full-duplex WebRTC)
```

---

## Why this exists

Every voice-enabled app ends up reimplementing the same things: provider selection, fallback chains, audio playback, microphone handling, ephemeral ConvAI agent management. This library extracts that into a single package with a clean API.

**What you get:**
- **Provider abstraction** — swap ElevenLabs for Fish Audio (or use both with automatic fallback) without touching your components
- **Drop-in Next.js handlers** — three `export { POST, GET }` lines replace your `/api/tts`, `/api/stt`, and `/api/convai/agent` routes
- **React hooks** — `useVoice`, `useSTT`, `useConversation` handle state, playback, and cleanup
- **Voice profile registry** — map named voices across all providers; one profile works with ElevenLabs, Fish Audio, and OpenAI simultaneously
- **Browser TTS fallback** — zero-cost fallback when no API key is configured

---

## Providers

| Provider | Type | Requires |
|----------|------|----------|
| [ElevenLabs](https://elevenlabs.io) | TTS + ConvAI | `ELEVENLABS_API_KEY` |
| [Fish Audio](https://fish.audio) | TTS | `FISH_AUDIO_API_KEY` |
| [OpenAI](https://platform.openai.com) | TTS | `OPENAI_API_KEY` |
| Browser Web Speech | TTS + STT | — (free, client-side only) |
| [Deepgram](https://deepgram.com) | STT | `DEEPGRAM_API_KEY` |

---

## Install

```bash
npm install @itsocialist/voice
# or
pnpm add @itsocialist/voice
```

### Peer dependencies

```bash
npm install next react react-dom   # if using Next.js handlers and React components
```

---

## Quick Start

### 1. Set environment variables

```bash
# .env.local
ELEVENLABS_API_KEY=your_key_here
FISH_AUDIO_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here        # optional fallback
DEEPGRAM_API_KEY=your_key_here      # optional, for server-side STT

TTS_PROVIDER=elevenlabs             # elevenlabs | fish | openai
STT_PROVIDER=deepgram               # deepgram | webspeech
```

### 2. Register your voice profiles

Create `src/lib/voice-profiles.ts` and register profiles at app startup (e.g., in your root layout):

```ts
import { voiceRegistry } from '@itsocialist/voice'
import type { VoiceProfile } from '@itsocialist/voice'

const narrator: VoiceProfile = {
  name: 'Narrator',
  elevenlabsVoiceId: 'YOUR_ELEVENLABS_VOICE_ID',
  fishModelId: 'YOUR_FISH_MODEL_ID',
  openaiVoice: 'nova',
  gender: 'female',
  ageRange: 'middle',
  elevenlabsSettings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.3,
    use_speaker_boost: true,
  },
  fishSettings: {
    temperature: 0.7,
    top_p: 0.8,
    speed: 1.0,
  },
}

voiceRegistry.register('narrator', narrator)
```

### 3. Add API routes

```ts
// app/api/tts/route.ts
export { POST, GET } from '@itsocialist/voice/next/tts-handler'

// app/api/stt/route.ts
export { POST, GET } from '@itsocialist/voice/next/stt-handler'

// app/api/convai/agent/route.ts  (only if using ElevenLabs ConvAI)
export { POST, DELETE } from '@itsocialist/voice/next/convai-handler'
```

### 4. Use in components

```tsx
import { AudioPlayer, VoiceInput } from '@itsocialist/voice/react'

// Play TTS
<AudioPlayer text="Hello world" profileKey="narrator" />

// Mic input with spacebar hotkey
<VoiceInput onTranscript={(text) => setInput(text)} />
```

---

## API Reference

### Server / Node — `@itsocialist/voice`

#### `synthesizeSpeech(request)`

Synthesize speech with automatic provider fallback.

```ts
import { synthesizeSpeech } from '@itsocialist/voice'

const result = await synthesizeSpeech({
  text: 'Hello world',
  voiceProfile: myProfile,
  format: 'mp3',                 // 'mp3' | 'wav' | 'opus' — default: 'mp3'
  preferredProvider: 'fish',     // override TTS_PROVIDER for this request only
})
// → { audioBuffer: ArrayBuffer, contentType: string, provider: string, latencyMs: number }
```

**Provider selection order:**
1. `preferredProvider` in the request (if that provider is available)
2. `TTS_PROVIDER` env var
3. ElevenLabs → Fish Audio → OpenAI (first with a configured key)

#### `getProviderStatus()`

```ts
import { getProviderStatus } from '@itsocialist/voice'

const { primary, available, fallbacks } = getProviderStatus()
// → { primary: 'elevenlabs', available: ['elevenlabs', 'fish'], fallbacks: ['fish'] }
```

#### `transcribeAudio(request)`

```ts
import { transcribeAudio } from '@itsocialist/voice'

const result = await transcribeAudio({
  audioBuffer,                   // ArrayBuffer from MediaRecorder
  contentType: 'audio/webm',
  language: 'en',
})
// → { transcript: string, confidence: number, provider: string, latencyMs: number }
```

#### `VoiceRegistry`

Maps named voice identities across all TTS providers.

```ts
import { voiceRegistry, VoiceRegistry } from '@itsocialist/voice'

// Global singleton (recommended)
voiceRegistry.register('narrator', narratorProfile)
voiceRegistry.register(['cfo', 'executive'], executiveProfile) // multiple keys → same profile

const profile = voiceRegistry.resolve('narrator')  // exact match
const profile = voiceRegistry.resolve('the CFO')   // fuzzy match → executiveProfile
const profile = voiceRegistry.resolve('unknown')   // → default profile

// Custom registry (e.g., for testing or multiple apps)
const registry = new VoiceRegistry(myDefaultProfile)
registry.registerAll({ coach: coachProfile, narrator: narratorProfile })
```

The registry does partial/fuzzy matching — `resolve('Champion / Internal Advocate')` will match a profile registered under `'champion'`.

#### ConvAI client

```ts
import { createConvAIAgent, deleteConvAIAgent } from '@itsocialist/voice'

// Create an ephemeral agent for a session
const agent = await createConvAIAgent({
  systemPrompt: 'You are a helpful assistant.',
  firstMessage: 'Hello! How can I help you today?',
  voiceId: 'YOUR_ELEVENLABS_VOICE_ID',
  agentName: 'Assistant',
})
// → { agentId: string, conversationToken?: string, signedUrl?: string }
// Returns both token types — use whichever your @elevenlabs/react SDK version expects

// Clean up on session end
await deleteConvAIAgent(agent.agentId)
```

> **Note:** ElevenLabs ConvAI only accepts `eleven_turbo_v2` or `eleven_flash_v2` as the TTS model — not `eleven_v3`. This is handled automatically.

---

### Next.js Handlers — `@itsocialist/voice/next`

#### `POST /api/tts`

```ts
// Request body
{
  text: string
  profileKey?: string          // looked up in voiceRegistry
  voiceProfile?: VoiceProfile  // explicit profile, bypasses registry
  provider?: 'elevenlabs' | 'fish' | 'openai' | 'browser'
  format?: 'mp3' | 'wav' | 'opus'
}

// Success response: audio/mpeg binary
// Response headers: X-TTS-Provider, X-TTS-Latency-Ms, X-Voice-Name

// When provider === 'browser':
// Returns JSON: { useBrowserTTS: true, text: string }
// The client is expected to synthesize using Web Speech API
```

#### `GET /api/tts` — provider status

```json
{ "primary": "elevenlabs", "available": ["elevenlabs", "fish"], "fallbacks": ["fish"] }
```

#### `POST /api/stt` — transcribe audio

```
Body: raw audio binary
Content-Type: audio/webm (or audio/wav)
Response: { transcript, confidence, provider, latencyMs }
```

#### `POST /api/convai/agent` — create ConvAI agent

```ts
// Request: { systemPrompt, firstMessage, voiceId, agentName }
// Response: { agent_id, conversation_token?, signed_url? }
```

#### `DELETE /api/convai/agent?agent_id=xxx` — cleanup agent

Always returns `{ ok: true }` (best-effort, never throws).

#### Custom registry in route handler

```ts
// app/api/tts/route.ts
import { createTTSHandler } from '@itsocialist/voice/next'
import { myRegistry } from '@/lib/voice-profiles'

export const { POST, GET } = createTTSHandler({ registry: myRegistry })
```

---

### React — `@itsocialist/voice/react`

#### `useVoice(options)` — TTS + playback

```tsx
import { useVoice } from '@itsocialist/voice/react'

function SpeakButton({ text }: { text: string }) {
  const { state, provider, speak, stop } = useVoice({
    ttsRoute: '/api/tts',   // default
    onPlayStart: () => console.log('playing'),
    onPlayEnd: () => console.log('done'),
  })

  return (
    <button onClick={() => state === 'playing' ? stop() : speak(text, { profileKey: 'narrator' })}>
      {state === 'loading' ? 'Generating...' : state === 'playing' ? 'Stop' : 'Play'}
    </button>
  )
}
```

**Per-request provider override:**
```ts
await speak(text, { provider: 'fish' })     // use Fish Audio for this request
await speak(text, { provider: 'browser' })  // use browser Web Speech API (free)
```

`state` values: `'idle' | 'loading' | 'playing' | 'error'`

#### `useSTT(options)` — speech-to-text

```tsx
import { useSTT } from '@itsocialist/voice/react'

function MicInput() {
  const { state, interimText, toggle, isSupported, micPermission } = useSTT({
    mode: 'browser',          // 'browser' (Web Speech, free) | 'server' (Deepgram)
    onTranscript: (text) => setInput(text),
    onInterim: (text) => setPreview(text),
    spacebarHotkey: true,     // spacebar toggles mic (default: true)
  })

  return <button onClick={toggle}>{state === 'listening' ? 'Stop' : 'Speak'}</button>
}
```

`state` values: `'idle' | 'listening' | 'processing' | 'error'`

#### `useConversation(options)` — ElevenLabs ConvAI

Full-duplex voice conversation: your app provides the agent config, this hook handles agent creation, SDK connection, and cleanup.

```tsx
import { useConversation } from '@itsocialist/voice/react'

function VoiceChat() {
  const conv = useConversation({
    agentRoute: '/api/convai/agent',
    buildConfig: () => ({
      systemPrompt: 'You are a helpful assistant.',
      firstMessage: 'Hello! How can I help you?',
      voiceId: 'YOUR_ELEVENLABS_VOICE_ID',
      agentName: 'Assistant',
    }),
    onMessage: (role, text) => addMessage({ role, text }),
    onStatusChange: (status) => console.log(status),
  })

  return (
    <>
      <p>Status: {conv.status}</p>
      <button onClick={conv.start} disabled={conv.status !== 'idle'}>Start</button>
      <button onClick={conv.stop} disabled={conv.status === 'idle'}>End</button>
    </>
  )
}
```

`status` values: `'idle' | 'connecting' | 'connected' | 'agent-speaking' | 'user-speaking' | 'disconnecting' | 'error'`

#### `<AudioPlayer />` — ready-made TTS player

```tsx
import { AudioPlayer } from '@itsocialist/voice/react'

<AudioPlayer
  text="Hello world"
  profileKey="narrator"        // or voiceProfile={explicitProfile}
  provider="elevenlabs"        // optional per-request override
  autoPlay={false}
  ttsRoute="/api/tts"          // default
  onPlayStart={() => {}}
  onPlayEnd={() => {}}
/>
```

#### `<VoiceInput />` — microphone button

```tsx
import { VoiceInput } from '@itsocialist/voice/react'

<VoiceInput
  onTranscript={(text) => setInput(text)}
  autoSend={true}
  onAutoSend={() => handleSubmit()}
  disabled={isLoading}
/>
```

Features: spacebar hotkey (toggles mic when not in an input field), interim transcript preview, mic permission state, not-supported fallback.

---

## Voice Profile Shape

```ts
interface VoiceProfile {
  name: string

  // Provider-specific voice identifiers
  elevenlabsVoiceId: string
  fishModelId: string
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

  // Metadata
  gender: 'male' | 'female'
  ageRange: 'young' | 'middle' | 'senior'
  style?: string

  // Per-provider tuning
  elevenlabsSettings: {
    stability: number           // 0.0–1.0  lower = more expressive
    similarity_boost: number    // 0.0–1.0  higher = more faithful to voice
    style: number               // 0.0–1.0  higher = more dramatic
    use_speaker_boost: boolean
  }
  fishSettings: {
    temperature: number         // 0.0–1.0  expressiveness
    top_p: number               // 0.0–1.0  diversity
    speed: number               // 0.5–2.0
  }
}
```

---

## Forking for your own needs

This library is intentionally minimal — it has no opinion about your voice profiles, routes, or UI. To add domain-specific voices, custom fallback logic, or different components:

```bash
gh repo fork itsocialist/voice --clone
cd voice
```

Then:
1. Add your voice profiles to `src/profiles/defaults.ts`
2. Extend `VoiceProfile` in `src/types.ts` if you need extra fields
3. Customize the React components in `react/components/` for your design system

---

## Known limitations

- **Deepgram STT** — implemented but not yet battle-tested. Treat as beta; fall back to `mode: 'browser'` if you hit issues.
- **Fish Audio model IDs** — Fish Audio uses reference model IDs tied to specific voice clones. You need to create or find a model in the Fish Audio console and use that ID in your profile.
- **Streaming TTS** — all synthesis returns a complete audio buffer. Low first-byte-latency streaming is not yet implemented.
- **ConvAI volume metering** — `agentVolume` in `useConversation` returns `0` or `1` only; real-time volume values require SDK-version-specific callbacks not yet abstracted here.

---

## License

MIT
