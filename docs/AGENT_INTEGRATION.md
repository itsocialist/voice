# Agent Integration Guide — @itsocialist/voice

> **For AI coding assistants:** Ingest this file before implementing voice capabilities in a Next.js app using `@itsocialist/voice`. It covers the full API surface, constraints, integration patterns, and common mistakes.

---

## What this library does

`@itsocialist/voice` provides:

1. **Server-side TTS synthesis** with automatic provider fallback (ElevenLabs → Fish Audio → OpenAI)
2. **Server-side STT transcription** via Deepgram (or browser Web Speech API client-side)
3. **ConvAI agent lifecycle management** for ElevenLabs full-duplex voice conversation (WebRTC)
4. **Three drop-in Next.js App Router route handlers** (`/api/tts`, `/api/stt`, `/api/convai/agent`)
5. **React hooks** (`useVoice`, `useSTT`, `useConversation`) and components (`AudioPlayer`, `VoiceInput`)
6. **VoiceRegistry** — maps named voice identities across all providers

---

## Package layout

```
@itsocialist/voice          → server/Node.js: synthesizeSpeech, transcribeAudio, voiceRegistry, ConvAI client
@itsocialist/voice/next     → Next.js App Router route handlers
@itsocialist/voice/react    → React hooks and components (client-side only)
```

---

## Required environment variables

```bash
ELEVENLABS_API_KEY=   # Required for ElevenLabs TTS and ConvAI
FISH_AUDIO_API_KEY=   # Required for Fish Audio TTS
OPENAI_API_KEY=       # Required for OpenAI TTS (optional fallback)
DEEPGRAM_API_KEY=     # Required for server-side STT

TTS_PROVIDER=elevenlabs   # Optional: elevenlabs | fish | openai (default: first available)
STT_PROVIDER=deepgram     # Optional: deepgram | webspeech
```

---

## Integration checklist

### 1. Install

```bash
npm install @itsocialist/voice
npm install next react react-dom   # if not already installed
```

### 2. Create voice profiles

```ts
// src/lib/voice-profiles.ts
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
// Register at app startup — e.g., in app/layout.tsx or a server component
```

**VoiceRegistry resolve order:**
1. Exact key match (case-insensitive)
2. Partial match (registered key contains query, or query contains registered key)
3. Default profile

### 3. Add API routes

```ts
// app/api/tts/route.ts
export { POST, GET } from '@itsocialist/voice/next/tts-handler'

// app/api/stt/route.ts
export { POST, GET } from '@itsocialist/voice/next/stt-handler'

// app/api/convai/agent/route.ts  (only if using ConvAI)
export { POST, DELETE } from '@itsocialist/voice/next/convai-handler'
```

To use a custom registry (e.g., if you register profiles lazily):

```ts
// app/api/tts/route.ts
import { createTTSHandler } from '@itsocialist/voice/next'
import { myRegistry } from '@/lib/voice-profiles'
export const { POST, GET } = createTTSHandler({ registry: myRegistry })
```

### 4. Use React hooks

```tsx
'use client'
import { useVoice, useSTT, useConversation } from '@itsocialist/voice/react'
```

---

## API Reference

### `synthesizeSpeech(request)` — server-side TTS

```ts
import { synthesizeSpeech } from '@itsocialist/voice'

const result = await synthesizeSpeech({
  text: 'Hello world',
  voiceProfile: myProfile,           // required
  format: 'mp3',                     // 'mp3' | 'wav' | 'opus' — default: 'mp3'
  preferredProvider: 'fish',         // optional per-request override
})
// → { audioBuffer: ArrayBuffer, contentType: string, provider: TTSProviderName, latencyMs: number }
```

**IMPORTANT:** Do NOT set `process.env.TTS_PROVIDER` per-request to override the provider. That is a race condition under concurrent requests. Use `preferredProvider` in the request object instead.

### `POST /api/tts` request body

```ts
{
  text: string                                    // required
  profileKey?: string                             // registry key, e.g. 'narrator'
  voiceProfile?: VoiceProfile                     // explicit profile (bypasses registry)
  provider?: 'elevenlabs' | 'fish' | 'openai' | 'browser'
  format?: 'mp3' | 'wav' | 'opus'
}
```

**Browser TTS special case:** When `provider === 'browser'`, the server returns `{ useBrowserTTS: true, text: string }` instead of audio. The client must handle synthesis via `SpeechSynthesisUtterance`. The `useVoice` hook does this automatically.

**Response headers on success:**
- `X-TTS-Provider` — which provider was used
- `X-TTS-Latency-Ms` — synthesis time in milliseconds
- `X-Voice-Name` — resolved voice profile name
- `Content-Type: audio/mpeg`

### `useVoice(options)` — client-side TTS + playback

```tsx
const { state, provider, speak, stop } = useVoice({
  ttsRoute: '/api/tts',     // default
  onPlayStart: () => {},
  onPlayEnd: () => {},
  onError: (err) => {},
})

// Trigger speech
await speak('Hello world', {
  profileKey: 'narrator',   // registry key on the server
  voiceProfile: profile,    // OR explicit profile
  provider: 'fish',         // OR per-request override
  format: 'mp3',
})

stop()  // interrupt current audio
```

`state`: `'idle' | 'loading' | 'playing' | 'error'`

### `useSTT(options)` — speech-to-text

```tsx
const { state, interimText, toggle, isSupported, micPermission } = useSTT({
  mode: 'browser',           // 'browser' (free, Web Speech) | 'server' (Deepgram)
  sttRoute: '/api/stt',      // only used when mode='server'
  onTranscript: (text) => {},
  onInterim: (text) => {},   // live partial transcript (browser mode only)
  spacebarHotkey: true,      // toggle mic on spacebar (default: true)
  language: 'en-US',
})
```

`state`: `'idle' | 'listening' | 'processing' | 'error'`
`micPermission`: `'prompt' | 'granted' | 'denied'`

**Spacebar hotkey** only fires when focus is not on an `<input>`, `<textarea>`, or `[contenteditable]`.

### `useConversation(options)` — ElevenLabs ConvAI

```tsx
const conv = useConversation({
  agentRoute: '/api/convai/agent',   // default
  buildConfig: async () => ({
    systemPrompt: 'You are a helpful assistant.',
    firstMessage: 'Hello! How can I help?',
    voiceId: 'YOUR_ELEVENLABS_VOICE_ID',
    agentName: 'Assistant',
  }),
  onMessage: (role, text) => {},    // role: 'agent' | 'user'
  onStatusChange: (status) => {},
  onError: (err) => {},
})

conv.start()   // creates agent, requests mic, connects WebRTC
conv.stop()    // ends session, cleans up agent
```

`conv.status`: `'idle' | 'connecting' | 'connected' | 'agent-speaking' | 'user-speaking' | 'disconnecting' | 'error'`
`conv.isSpeaking`: boolean (true when `status === 'agent-speaking'`)
`conv.error`: string | null

**ConvAI agent creation flow:**
1. `buildConfig()` is called (can be async)
2. POST to `agentRoute` with `{ systemPrompt, firstMessage, voiceId, agentName }`
3. Server returns `{ agent_id, conversation_token?, signed_url? }`
4. Hook prefers `conversation_token` (WebRTC) over `signed_url` (WebSocket)
5. On `stop()`, DELETE `agentRoute?agent_id=xxx` (best-effort cleanup)

### `createConvAIAgent(config)` — server-side agent creation

```ts
import { createConvAIAgent, deleteConvAIAgent } from '@itsocialist/voice'

const agent = await createConvAIAgent({
  systemPrompt: 'You are a sales coach.',
  firstMessage: 'Hi, ready to practice?',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  agentName: 'Coach',
})
// → { agentId: string, conversationToken?: string, signedUrl?: string }

await deleteConvAIAgent(agent.agentId)   // cleanup
```

---

## VoiceProfile type

```ts
interface VoiceProfile {
  name: string
  elevenlabsVoiceId: string
  fishModelId: string
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  gender: 'male' | 'female'
  ageRange: 'young' | 'middle' | 'senior'
  style?: string
  elevenlabsSettings: {
    stability: number           // 0.0–1.0 (lower = more expressive)
    similarity_boost: number    // 0.0–1.0 (higher = more faithful)
    style: number               // 0.0–1.0 (higher = more dramatic)
    use_speaker_boost: boolean
  }
  fishSettings: {
    temperature: number         // 0.0–1.0
    top_p: number               // 0.0–1.0
    speed: number               // 0.5–2.0
  }
}
```

---

## Known constraints

### ConvAI TTS models
ElevenLabs ConvAI **only accepts `eleven_turbo_v2` or `eleven_flash_v2`** as the TTS model inside an agent. `eleven_v3` is not supported for agents. This is handled automatically by the library.

### Fish Audio model IDs
`fishModelId` must be a reference model ID from the Fish Audio console — a specific voice clone. Built-in Fish Audio voices use a different API path and are not currently supported.

### Deepgram STT
Implemented but treat as beta. Fall back to `mode: 'browser'` (Web Speech API) if you encounter issues. Browser mode is free and works for most English use cases.

### ConvAI volume metering
`useConversation` returns `agentVolume` as `0` or `1` only (not a real-time level). Real amplitude data requires version-specific SDK callbacks not yet abstracted here.

### Streaming TTS
All TTS synthesis returns a complete audio buffer. First-byte-latency streaming (chunk-by-chunk playback) is not yet implemented. For long texts, prefer chunking at sentence boundaries before calling `speak()`.

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| `process.env.TTS_PROVIDER = 'fish'` in a route handler | Use `preferredProvider: 'fish'` in `TTSRequest` |
| Calling `useConversation` without `@elevenlabs/react` installed | Add `@elevenlabs/react` as a dependency |
| Using `eleven_v3` as the ConvAI voice model | Only `eleven_turbo_v2` / `eleven_flash_v2` work for agents |
| Registering profiles in a Client Component | Register in a Server Component or layout — `voiceRegistry` is server-side |
| Forgetting `'use client'` on React hook files | Hooks must be in Client Components |
| `fishModelId: 'YOUR_FISH_MODEL_ID'` left as placeholder | Replace with a real reference model ID from Fish Audio console |
| Not calling `conv.stop()` on component unmount | Always wire `conv.stop()` to a `useEffect` cleanup or an unmount handler |

---

## Example: minimal voice-enabled page

```tsx
// app/page.tsx
'use client'
import { useVoice, useSTT } from '@itsocialist/voice/react'
import { useState } from 'react'

export default function VoicePage() {
  const [transcript, setTranscript] = useState('')
  const { state: ttsState, speak } = useVoice()
  const { state: sttState, toggle } = useSTT({
    mode: 'browser',
    onTranscript: (text) => {
      setTranscript(text)
      speak(text, { profileKey: 'narrator' })  // echo back via TTS
    },
  })

  return (
    <div>
      <button onClick={toggle}>
        {sttState === 'listening' ? 'Stop' : 'Speak'}
      </button>
      <p>{transcript}</p>
      <p>TTS: {ttsState}</p>
    </div>
  )
}
```

---

## Example: ConvAI integration

```tsx
// app/chat/page.tsx
'use client'
import { useConversation } from '@itsocialist/voice/react'
import { useState } from 'react'

export default function ChatPage() {
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([])

  const conv = useConversation({
    buildConfig: () => ({
      systemPrompt: 'You are a helpful assistant. Be concise.',
      firstMessage: 'Hello! How can I help you today?',
      voiceId: process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? '',
      agentName: 'Assistant',
    }),
    onMessage: (role, text) =>
      setMessages((prev) => [...prev, { role, text }]),
  })

  return (
    <div>
      <button
        onClick={conv.status === 'idle' ? conv.start : conv.stop}
        disabled={conv.status === 'connecting' || conv.status === 'disconnecting'}
      >
        {conv.status === 'idle' ? 'Start Conversation' : 'End Conversation'}
      </button>
      <p>Status: {conv.status}</p>
      {conv.error && <p style={{ color: 'red' }}>{conv.error}</p>}
      <ul>
        {messages.map((m, i) => (
          <li key={i}><strong>{m.role}:</strong> {m.text}</li>
        ))}
      </ul>
    </div>
  )
}
```

---

## File reference

```
voice-lib/
├── src/
│   ├── types.ts                  All shared TypeScript types
│   ├── profiles/registry.ts      VoiceRegistry + DEFAULT_VOICE_PROFILE + voiceRegistry singleton
│   ├── router/tts.ts             synthesizeSpeech, getProviderStatus, resetProviders
│   ├── router/stt.ts             transcribeAudio, getSTTStatus
│   ├── convai/client.ts          createConvAIAgent, deleteConvAIAgent
│   ├── providers/tts/
│   │   ├── elevenlabs.ts         ElevenLabsProvider
│   │   ├── fish-audio.ts         FishAudioProvider
│   │   └── openai.ts             OpenAITTSProvider
│   └── providers/stt/
│       └── deepgram.ts           DeepgramSTTProvider
├── next/
│   ├── tts-handler.ts            createTTSHandler, POST, GET
│   ├── stt-handler.ts            POST, GET
│   └── convai-handler.ts         POST, DELETE
└── react/
    ├── hooks/
    │   ├── useVoice.ts
    │   ├── useSTT.ts
    │   └── useConversation.ts
    └── components/
        ├── AudioPlayer.tsx
        └── VoiceInput.tsx
```
