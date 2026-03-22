# @briandawson/voice

Multi-provider voice library for Next.js apps. Unified API across ElevenLabs, Fish Audio, OpenAI TTS, Deepgram STT, and ElevenLabs ConvAI — with React hooks, drop-in Next.js route handlers, and a generic voice profile registry.

Extracted from [`sales-sim-trainer`](../sales-sim-trainer) and [`power-speaker`](../power-speaker).

---

## Providers

| Provider | Type | Status | Key env var |
|----------|------|--------|------------|
| ElevenLabs | TTS | ✅ Tested | `ELEVENLABS_API_KEY` |
| Fish Audio | TTS | ✅ Tested (power-speaker) | `FISH_AUDIO_API_KEY` |
| OpenAI TTS | TTS | ✅ Implemented | `OPENAI_API_KEY` |
| Browser Web Speech | TTS | ✅ Client-side, no key | — |
| Deepgram Nova-2 | STT | ⚠️ Implemented, untested | `DEEPGRAM_API_KEY` |
| Browser Web Speech | STT | ✅ Client-side, no key | — |
| ElevenLabs ConvAI | Full-duplex | ✅ Tested (power-speaker) | `ELEVENLABS_API_KEY` |

---

## Install

Until published to npm, add as a local workspace dependency:

```json
{
  "dependencies": {
    "@briandawson/voice": "file:../../voice-lib"
  }
}
```

---

## Quick Start

### 1. Set environment variables

```bash
ELEVENLABS_API_KEY=sk_...
FISH_AUDIO_API_KEY=...
OPENAI_API_KEY=sk-...        # optional fallback
DEEPGRAM_API_KEY=...         # optional, for server-side STT
TTS_PROVIDER=elevenlabs      # elevenlabs | fish | openai
STT_PROVIDER=deepgram        # deepgram (server) | webspeech (client)
```

### 2. Register voice profiles

Create `src/lib/voice-profiles.ts` in your app and call this before any route handler runs (e.g., in a root layout or middleware):

```ts
import { voiceRegistry } from '@briandawson/voice'

voiceRegistry.registerAll({
  'narrator': {
    name: 'Narrator',
    elevenlabsVoiceId: 'EXAVITQu4vr4xnSDxMaL',
    fishModelId: '7f92f8afb8ec43bf81429cc1c9199cb1',
    openaiVoice: 'nova',
    gender: 'female',
    ageRange: 'middle',
    elevenlabsSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
    fishSettings: { temperature: 0.7, top_p: 0.8, speed: 1.0 },
  },
})
```

### 3. Add API routes

```ts
// app/api/tts/route.ts
export { POST, GET } from '@briandawson/voice/next/tts-handler'

// app/api/stt/route.ts
export { POST, GET } from '@briandawson/voice/next/stt-handler'

// app/api/convai/agent/route.ts
export { POST, DELETE } from '@briandawson/voice/next/convai-handler'
```

### 4. Use in components

```tsx
import { AudioPlayer, VoiceInput, useVoice, useSTT, useConversation } from '@briandawson/voice/react'

// Play TTS audio
<AudioPlayer text="Hello world" profileKey="narrator" />

// Microphone input
<VoiceInput onTranscript={(text) => setInput(text)} />
```

---

## API Reference

### Server / Node (`@briandawson/voice`)

#### `synthesizeSpeech(request)`

Synthesize speech with automatic provider fallback.

```ts
import { synthesizeSpeech } from '@briandawson/voice'

const result = await synthesizeSpeech({
  text: 'Hello world',
  voiceProfile: myProfile,
  format: 'mp3',                    // 'mp3' | 'wav' | 'opus'
  preferredProvider: 'fish',        // override TTS_PROVIDER for this request
})
// result: { audioBuffer, contentType, provider, latencyMs }
```

Provider selection order:
1. `preferredProvider` in request (if available)
2. `TTS_PROVIDER` env var (if available)
3. ElevenLabs → Fish Audio → OpenAI (first available)

#### `getProviderStatus()`

```ts
const status = getProviderStatus()
// { primary: 'elevenlabs', available: ['elevenlabs', 'fish'], fallbacks: ['fish'] }
```

#### `transcribeAudio(request)`

Server-side STT via Deepgram.

```ts
import { transcribeAudio } from '@briandawson/voice'

const result = await transcribeAudio({
  audioBuffer,          // ArrayBuffer
  contentType: 'audio/webm',
  language: 'en',
})
// result: { transcript, confidence, provider, latencyMs, isFinal }
```

#### `VoiceRegistry`

Generic voice profile store. Apps register domain-specific profiles; the registry handles fuzzy lookup and fallback to a default.

```ts
import { voiceRegistry, VoiceRegistry, DEFAULT_VOICE_PROFILE } from '@briandawson/voice'

// Global singleton (recommended)
voiceRegistry.registerAll({ 'coach': coachProfile, 'narrator': narratorProfile })
const profile = voiceRegistry.resolve('coach')

// Partial/fuzzy match — useful for long condition strings
// e.g. voiceRegistry.resolve('Champion / Internal Advocate') will match key 'champion'

// Custom registry with a different default
const myRegistry = new VoiceRegistry(myDefaultProfile)
myRegistry.register(['cfo', 'economic-buyer'], cfoProfile)
```

#### ConvAI client

```ts
import { createConvAIAgent, deleteConvAIAgent, getSignedUrl } from '@briandawson/voice'

const agent = await createConvAIAgent({
  systemPrompt: '...',
  firstMessage: 'Hello!',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  agentName: 'Assistant',
})
// agent: { agentId, conversationToken?, signedUrl? }
// Returns both — use whichever your ElevenLabs SDK version expects.

await deleteConvAIAgent(agent.agentId) // call on session end
```

**ConvAI model constraint:** only `eleven_turbo_v2` or `eleven_flash_v2` work for ConvAI agents (not `eleven_v3`). This is handled automatically.

---

### Next.js Handlers (`@briandawson/voice/next`)

All handlers are exportable from their route files with zero config when using the global registry.

#### `POST /api/tts`

```ts
// Request body
{
  text: string
  profileKey?: string        // looked up in voiceRegistry
  voiceProfile?: VoiceProfile // explicit profile (overrides profileKey)
  provider?: 'elevenlabs' | 'fish' | 'openai' | 'browser'
  format?: 'mp3' | 'wav' | 'opus'
}

// Response: audio/mpeg binary
// Headers: X-TTS-Provider, X-TTS-Latency-Ms, X-Voice-Name

// Special case: provider='browser'
// Returns: { useBrowserTTS: true, text: string }
// Client handles synthesis via Web Speech API
```

#### `GET /api/tts`

Returns provider status JSON.

#### `POST /api/stt`

```
Body: raw audio binary
Content-Type: audio/webm (or audio/wav)
Response: { transcript, confidence, provider, latencyMs }
```

#### `POST /api/convai/agent`

```ts
// Request body
{ systemPrompt, firstMessage, voiceId, agentName }

// Response
{ agent_id, conversation_token?, signed_url? }
```

#### `DELETE /api/convai/agent?agent_id=xxx`

Best-effort cleanup. Always returns `{ ok: true }`.

#### Custom registry in route handler

```ts
// app/api/tts/route.ts
import { createTTSHandler } from '@briandawson/voice/next'
import { myRegistry } from '@/lib/voice-profiles'

export const { POST, GET } = createTTSHandler({ registry: myRegistry })
```

---

### React (`@briandawson/voice/react`)

#### `useVoice(options)`

Synthesize and play TTS audio from a component.

```tsx
import { useVoice } from '@briandawson/voice/react'

const { state, provider, speak, stop, error } = useVoice({
  ttsRoute: '/api/tts',     // default
  autoPlay: false,
  onPlayStart: () => {},
  onPlayEnd: () => {},
})

// state: 'idle' | 'loading' | 'playing' | 'error'

await speak('Hello world', {
  profileKey: 'narrator',
  provider: 'fish',          // optional per-request override
})

stop() // stop playback
```

#### `useSTT(options)`

Speech-to-text with browser or server backend.

```tsx
import { useSTT } from '@briandawson/voice/react'

const { state, interimText, toggle, isSupported, micPermission } = useSTT({
  mode: 'browser',           // 'browser' (Web Speech) | 'server' (Deepgram)
  sttRoute: '/api/stt',
  onTranscript: (text) => setInput(text),
  onInterim: (text) => setPreview(text),
  spacebarHotkey: true,      // spacebar toggles mic
})

// state: 'idle' | 'listening' | 'processing' | 'error'
toggle() // start or stop
```

#### `useConversation(options)`

ElevenLabs ConvAI full-duplex conversation lifecycle.

```tsx
import { useConversation } from '@briandawson/voice/react'

const conv = useConversation({
  agentRoute: '/api/convai/agent',
  buildConfig: () => ({
    systemPrompt: 'You are a helpful assistant.',
    firstMessage: 'Hi! How can I help you?',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    agentName: 'Assistant',
  }),
  onMessage: (role, text) => console.log(role, text),
  onStatusChange: (status) => console.log(status),
})

// conv.status: 'idle' | 'connecting' | 'connected' | 'agent-speaking' | 'user-speaking' | 'disconnecting' | 'error'
// conv.isSpeaking: boolean
// conv.start() / conv.stop()
```

#### `<AudioPlayer />`

```tsx
<AudioPlayer
  text="Hello world"
  profileKey="narrator"          // registry key
  provider="elevenlabs"          // optional override
  autoPlay={false}
  ttsRoute="/api/tts"
  onPlayStart={() => {}}
  onPlayEnd={() => {}}
/>
```

#### `<VoiceInput />`

```tsx
<VoiceInput
  onTranscript={(text) => setInput(text)}
  autoSend={true}
  onAutoSend={() => handleSubmit()}
  disabled={isLoading}
/>
// Spacebar hotkey built-in (toggles mic when not in an input field)
```

---

## Voice Profile Shape

```ts
interface VoiceProfile {
  name: string
  elevenlabsVoiceId: string     // ElevenLabs voice ID
  fishModelId: string           // Fish Audio reference model ID
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  gender: 'male' | 'female'
  ageRange: 'young' | 'middle' | 'senior'
  style?: string                // description for reference
  elevenlabsSettings: {
    stability: number           // 0.0–1.0 (lower = more expressive)
    similarity_boost: number    // 0.0–1.0 (higher = more faithful)
    style: number               // 0.0–1.0 (higher = more dramatic)
    use_speaker_boost: boolean
  }
  fishSettings: {
    temperature: number         // 0.0–1.0 expressiveness
    top_p: number               // 0.0–1.0 diversity
    speed: number               // 0.5–2.0
  }
}
```

---

## Projects using this library

| Project | TTS | STT | ConvAI | Notes |
|---------|-----|-----|--------|-------|
| `sales-sim-trainer` | EL + Fish + OAI | Web Speech | ✅ | Stakeholder voice profiles |
| `power-speaker` | EL + Fish + OAI | Web Speech | ✅ | Coaching voice profiles |
| `facets-translator` | EL (planned) | — | — | Read-aloud feature (sprint #44) |
| `pm-hub` | EL | — | — | Briefing audio |
| `kidbuxx-team` | EL | — | — | Story narration |
| `claude-cowork` | EL | — | — | Briefing audio |
| `ai-outbound-caller` | EL + Google WaveNet | — | — | Python backend (separate port) |

---

## Known Limitations

- **Deepgram STT** — implemented but untested. Key is commented out in all current projects. Treat as beta.
- **Fish Audio** — tested and working in `power-speaker`. `sales-sim-trainer` has the key field but it's empty.
- **Streaming** — all synthesis returns a full audio buffer. Streaming (for lower first-byte latency) is not yet implemented.
- **ConvAI volume** — `agentVolume` in `useConversation` returns 0 or 1 only; real-time volume metering requires the ElevenLabs SDK's volume callback which varies by SDK version.
