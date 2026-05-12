# @itsocialist/voice — Agent Reference

> Machine-readable API reference for LLMs. Covers every exported symbol, parameter, return type, default, and constraint as of the current codebase. Update this file whenever a new export is added, renamed, or removed.

---

## Package Identity

```
npm package : @itsocialist/voice
repo        : github.com/itsocialist/voice
language    : TypeScript (source shipped as .ts, consumed via transpilePackages or tsc)
```

---

## Entry Points

| Import path | Contents |
|---|---|
| `@itsocialist/voice` | Server/Node — TTS, STT, ConvAI, VoiceRegistry, all types |
| `@itsocialist/voice/next` | Next.js App Router route handlers |
| `@itsocialist/voice/react` | React hooks and UI components (Client Components) |
| `@itsocialist/voice/next/tts-handler` | TTS handler directly |
| `@itsocialist/voice/next/stt-handler` | STT handler directly |
| `@itsocialist/voice/next/convai-handler` | ConvAI handler directly |

---

## Environment Variables

| Variable | Required by | Purpose |
|---|---|---|
| `ELEVENLABS_API_KEY` | TTS (ElevenLabs), ConvAI | All ElevenLabs API calls |
| `FISH_AUDIO_API_KEY` | TTS (Fish Audio) | Fish Audio synthesis |
| `OPENAI_API_KEY` | TTS (OpenAI) | OpenAI TTS synthesis |
| `DEEPGRAM_API_KEY` | STT (Deepgram) | Server-side transcription |
| `TTS_PROVIDER` | TTS router | Default provider: `elevenlabs` \| `fish` \| `openai` |
| `STT_PROVIDER` | STT router | Default provider: `deepgram` \| `webspeech` |

None are required at import time — missing keys cause individual operations to fail, not startup.

---

## Core Types

All types are exported from `@itsocialist/voice`. React and Next.js packages re-use these; do not re-import them from sub-paths.

### Provider names

```ts
type TTSProviderName = 'elevenlabs' | 'fish' | 'openai' | 'cartesia' | 'deepgram'
type STTProviderName = 'webspeech' | 'deepgram'
```

### VoiceProfile

Maps one voice identity across all TTS providers. Apps define their own and register them in `VoiceRegistry`.

```ts
interface VoiceProfile {
  name: string                               // Human-readable label

  // Provider voice IDs — all required at definition time
  elevenlabsVoiceId: string
  fishModelId: string
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  cartesiaVoiceId?: string                   // optional
  deepgramVoiceId?: string                   // optional

  // Metadata
  gender: 'male' | 'female'
  ageRange: 'young' | 'middle' | 'senior'
  style?: string                             // free-text description

  // Per-provider synthesis tuning
  elevenlabsSettings: {
    stability: number           // 0.0–1.0  lower = more expressive
    similarity_boost: number    // 0.0–1.0  higher = more faithful
    style: number               // 0.0–1.0  higher = more dramatic
    use_speaker_boost: boolean
  }
  fishSettings: {
    temperature: number         // 0.0–1.0
    top_p: number               // 0.0–1.0
    speed: number               // 0.5–2.0
  }
}
```

### TTSRequest / TTSResponse

```ts
interface TTSRequest {
  text: string
  voiceProfile: VoiceProfile
  format?: 'mp3' | 'wav' | 'opus'        // default: 'mp3'
  preferredProvider?: TTSProviderName | 'browser'
}

interface TTSResponse {
  audioBuffer: ArrayBuffer
  contentType: string
  provider: TTSProviderName
  latencyMs: number
}

interface TTSStreamResponse {
  stream: ReadableStream<Uint8Array>
  contentType: string
  provider: TTSProviderName
}

interface BrowserTTSSignal {
  useBrowserTTS: true
  text: string
}
```

### STTRequest / STTResponse

```ts
interface STTRequest {
  audioBuffer: ArrayBuffer
  contentType: string
  language?: string
}

interface STTResponse {
  transcript: string
  confidence: number
  provider: STTProviderName
  latencyMs: number
  isFinal: boolean
}
```

### ConvAI types

```ts
// VAD turn detection — reduces perceived response latency
interface ConvAITurnDetection {
  type: 'server_vad'
  silence_duration_ms?: number   // ElevenLabs default ~700ms; recommend 400 for fast-paced apps
  threshold?: number             // VAD sensitivity 0.0–1.0
}

// Full agent configuration (used by createConvAIAgent and resolveUniversalAgent)
interface ConvAIAgentConfig {
  systemPrompt: string
  firstMessage: string
  voiceId: string                // ElevenLabs voice ID
  agentName: string
  maxDurationSeconds?: number    // default 3600 (1hr); ElevenLabs default is 600s
  modelId?: string               // default 'eleven_v3_conversational'
                                 // options: 'eleven_flash_v2', 'eleven_turbo_v2'
  stability?: number             // TTS stability 0.0–1.0; v3 default 0.5
  similarityBoost?: number       // TTS similarity boost 0.0–1.0; default 0.75
  turnDetection?: ConvAITurnDetection
  timeoutMs?: number             // fetch timeout ms for all internal calls; default 15000
}

// Returned from createConvAIAgent and getSignedUrlWithOverrides
interface ConvAIAgentResult {
  agentId: string
  signedUrl?: string             // WebSocket URL, valid ~15 min
  conversationToken?: string     // WebRTC token (newer ElevenLabs SDK versions)
}

// Per-session overrides for getSignedUrlWithOverrides (1 API call at session start)
interface ConvAISessionOverrides {
  systemPrompt?: string
  firstMessage?: string
  voiceId?: string
  turnDetection?: ConvAITurnDetection
}
```

### Route body types (for Next.js handlers)

```ts
interface TTSRouteBody {
  text: string
  profileKey?: string            // registry key lookup
  voiceProfile?: VoiceProfile    // explicit profile, bypasses registry
  provider?: TTSProviderName | 'browser'
  format?: 'mp3' | 'wav' | 'opus'
}

interface ConvAIAgentRouteBody {
  // Required
  systemPrompt: string
  firstMessage: string
  voiceId: string
  agentName: string
  // Optional — all ConvAIAgentConfig fields
  maxDurationSeconds?: number
  modelId?: string
  stability?: number
  similarityBoost?: number
  turnDetection?: ConvAITurnDetection
  timeoutMs?: number
}

interface STTRouteResponse {
  transcript: string
  confidence: number
  provider: STTProviderName
  latencyMs: number
}
```

### ConvAIError

Typed error class thrown by all ConvAI client functions. Catch and inspect `code` for HTTP status mapping.

```ts
class ConvAIError extends Error {
  readonly code:
    | 'API_KEY_MISSING'        // ELEVENLABS_API_KEY not set
    | 'AGENT_CREATION_FAILED'  // 4xx from ElevenLabs agent create endpoint
    | 'SIGNED_URL_FAILED'      // failed to fetch signed URL
    | 'ELEVENLABS_UNAVAILABLE' // 5xx from ElevenLabs
    | 'OVERRIDE_FAILED'        // failed to apply session overrides
  readonly status?: number     // upstream HTTP status code if available
}
```

Usage:
```ts
import { createConvAIAgent, ConvAIError } from '@itsocialist/voice'

try {
  const result = await createConvAIAgent(config)
} catch (e) {
  if (e instanceof ConvAIError) {
    if (e.code === 'ELEVENLABS_UNAVAILABLE') return Response.json({ error: 'Voice unavailable' }, { status: 503 })
    if (e.code === 'API_KEY_MISSING')        return Response.json({ error: 'Config error' },     { status: 500 })
    if (e.code === 'AGENT_CREATION_FAILED')  return Response.json({ error: e.message },           { status: 422 })
  }
  throw e
}
```

---

## Server / Node API — `@itsocialist/voice`

### TTS

#### `synthesizeSpeech(request: TTSRequest): Promise<TTSResponse>`

Synthesizes speech with automatic provider selection and fallback.

Provider selection order:
1. `request.preferredProvider` (if that provider has a key configured)
2. `TTS_PROVIDER` env var
3. ElevenLabs → Fish Audio → OpenAI (first available)

Throws if no provider is available.

```ts
import { synthesizeSpeech } from '@itsocialist/voice'

const result = await synthesizeSpeech({
  text: 'Hello world',
  voiceProfile: myProfile,
  format: 'mp3',
  preferredProvider: 'fish',
})
// → { audioBuffer, contentType, provider, latencyMs }
```

#### `synthesizeSpeechStream(request: TTSRequest): Promise<TTSStreamResponse>`

Streaming variant. Stream starts before synthesis is complete (lower time-to-first-audio).
Not all providers support streaming; falls back to buffered synthesis if needed.

#### `getProviderStatus(): TTSProviderStatus`

Returns current provider availability without making API calls.

```ts
const { primary, available, fallbacks } = getProviderStatus()
// → { primary: 'elevenlabs', available: ['elevenlabs', 'fish'], fallbacks: ['fish'] }
```

#### `resetProviders(): void`

Clears cached provider availability state. Useful after changing env vars or in tests.

---

### STT

#### `transcribeAudio(request: STTRequest): Promise<STTResponse>`

Transcribes audio using the configured STT provider (default: Deepgram via `STT_PROVIDER`).

```ts
import { transcribeAudio } from '@itsocialist/voice'

const result = await transcribeAudio({
  audioBuffer,          // ArrayBuffer from MediaRecorder
  contentType: 'audio/webm',
  language: 'en',
})
// → { transcript, confidence, provider, latencyMs, isFinal }
```

#### `getSTTStatus(): STTProviderStatus`

Returns current STT provider status.

---

### ConvAI Client

All functions apply `AbortSignal.timeout(config.timeoutMs ?? 15000)` to every `fetch()` call. All throw `ConvAIError` on failure.

#### `createConvAIAgent(config: ConvAIAgentConfig, apiKey?: string): Promise<ConvAIAgentResult>`

Creates a new ephemeral ConvAI agent (3 API calls: create → token → signed URL run in parallel after creation).

Use for: session-per-agent patterns, testing, or when each session needs a unique agent config.

**Latency:** ~600–900ms (3 sequential + parallel API calls).

```ts
const result = await createConvAIAgent({
  systemPrompt: 'You are a sales coach.',
  firstMessage: 'Hello! Ready to practice?',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  agentName: 'Coach',
  turnDetection: { type: 'server_vad', silence_duration_ms: 400 },
  timeoutMs: 15000,
})
// → { agentId, signedUrl?, conversationToken? }
// Use signedUrl for @elevenlabs/react startSession({ signedUrl })
// Use conversationToken for newer WebRTC-based SDK versions
```

#### `resolveUniversalAgent(name: string, baseConfig: ConvAIAgentConfig, apiKey?: string): Promise<string>`

Creates a "universal" agent at server boot and returns its `agentId`. The caller caches the returned ID.

**Pattern:** Call once at module scope with lazy initialization:

```ts
import { resolveUniversalAgent } from '@itsocialist/voice'

let agentIdPromise: Promise<string> | null = null
function getUniversalAgent() {
  agentIdPromise ??= resolveUniversalAgent('MyApp-Universal', BASE_CONFIG)
  return agentIdPromise
}

// Per session — uses the cached agentId
const agentId = await getUniversalAgent()
```

Returns: `agentId` string (not a full `ConvAIAgentResult`).

#### `getSignedUrlWithOverrides(agentId: string, overrides: ConvAISessionOverrides, apiKey?: string): Promise<ConvAIAgentResult>`

Gets a signed URL for an existing universal agent with per-session config overrides.

**Latency:** ~200ms (1 API call). Designed to replace `createConvAIAgent` in high-concurrency apps.

```ts
import { resolveUniversalAgent, getSignedUrlWithOverrides } from '@itsocialist/voice'

// At route initialization (cached):
const agentId = await getUniversalAgent()

// Per session (fast path):
const result = await getSignedUrlWithOverrides(agentId, {
  systemPrompt: 'You are coaching Alice.',
  firstMessage: 'Hi Alice! Let\'s begin.',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  turnDetection: { type: 'server_vad', silence_duration_ms: 400 },
})
// → { agentId, signedUrl? }
```

All `overrides` fields are optional — omit any field to inherit the universal agent's base config.

#### `deleteConvAIAgent(agentId: string, options?: { apiKey?: string; onError?: (err: Error) => void }): Promise<void>`

Deletes an agent. Best-effort: never throws. Pass `onError` for visibility into cleanup failures.

```ts
// Silent (old behavior)
await deleteConvAIAgent(agentId)

// With error visibility (recommended)
await deleteConvAIAgent(agentId, {
  onError: (e) => console.warn('[voice] agent cleanup failed:', e),
})
```

#### `getSignedUrl(agentId: string, apiKey?: string): Promise<string>`

Gets a signed URL for an existing agent without session overrides. Simple GET call.

Returns the `signed_url` string directly.

---

### VoiceRegistry

Maps named voice identities to `VoiceProfile` objects. Supports fuzzy matching so agent-generated persona names resolve correctly.

#### Global singleton (recommended)

```ts
import { voiceRegistry } from '@itsocialist/voice'

voiceRegistry.register('narrator', narratorProfile)
voiceRegistry.register(['cfo', 'executive'], executiveProfile)  // multi-key
voiceRegistry.registerAll({ coach: coachProfile, assistant: assistantProfile })

const profile = voiceRegistry.resolve('narrator')           // exact
const profile = voiceRegistry.resolve('the CFO voice')      // fuzzy → executiveProfile
const profile = voiceRegistry.resolve('unknown-key')        // → default profile (never throws)
const profile = voiceRegistry.getDefault()                  // always the default profile
```

#### Custom instance

```ts
import { VoiceRegistry, DEFAULT_VOICE_PROFILE } from '@itsocialist/voice'

const registry = new VoiceRegistry(myDefaultProfile)
registry.registerAll({ narrator: narratorProfile })
```

---

### Direct Provider Access

For advanced use (custom synthesis logic). All providers implement `TTSProvider` or `STTProvider`.

```ts
import {
  ElevenLabsProvider,
  FishAudioProvider,
  OpenAITTSProvider,
  CartesiaProvider,
  DeepgramTTSProvider,
  DeepgramSTTProvider,
} from '@itsocialist/voice'
```

Each provider: `{ name, synthesize(request), synthesizeStream?(request), isAvailable() }` for TTS; `{ name, transcribe(request), isAvailable() }` for STT.

---

## Next.js Handlers — `@itsocialist/voice/next`

All handlers are plain `async function(request: Request): Promise<Response>` — compatible with the Next.js App Router `route.ts` pattern.

### TTS Handler

```ts
// app/api/tts/route.ts

// Zero-config drop-in (uses global voiceRegistry)
export { ttsPost as POST, ttsGet as GET } from '@itsocialist/voice/next'

// OR with custom registry:
import { createTTSHandler } from '@itsocialist/voice/next'
import { myRegistry } from '@/lib/voice-profiles'
export const { POST, GET } = createTTSHandler({ registry: myRegistry })
```

**POST** — body: `TTSRouteBody`

Response:
- Success: `audio/mpeg` binary with headers `X-TTS-Provider`, `X-TTS-Latency-Ms`, `X-Voice-Name`
- `provider === 'browser'`: JSON `{ useBrowserTTS: true, text: string }` — client synthesizes via Web Speech API
- Error: JSON `{ error: string }` with status 400 or 500

**GET** — returns `TTSProviderStatus` JSON (health check, no API call made).

### STT Handler

```ts
// app/api/stt/route.ts
export { sttPost as POST, sttGet as GET } from '@itsocialist/voice/next'
```

**POST** — raw audio body, `Content-Type: audio/webm` (or `audio/wav`)

Response: `STTRouteResponse` JSON `{ transcript, confidence, provider, latencyMs }`

**GET** — returns STT provider status.

### ConvAI Handler

```ts
// app/api/convai/agent/route.ts
export { convaiPost as POST, convaiDelete as DELETE } from '@itsocialist/voice/next'
```

**POST** — body: `ConvAIAgentRouteBody`

Required fields: `systemPrompt`, `firstMessage`, `voiceId`

Optional fields: `agentName`, `maxDurationSeconds`, `modelId`, `stability`, `similarityBoost`, `turnDetection`, `timeoutMs`

Response: `{ agent_id: string, conversation_token?: string, signed_url?: string }`

The handler catches `ConvAIError` and maps codes to HTTP statuses:
- `ELEVENLABS_UNAVAILABLE` → 503
- `API_KEY_MISSING` → 500
- `AGENT_CREATION_FAILED` / others → upstream `status ?? 500`

Error response shape: `{ error: string, code?: string }`

**DELETE** `?agent_id=xxx` — best-effort agent cleanup. Always returns `{ ok: true }`. Logs cleanup failures via `console.warn`.

---

## React — `@itsocialist/voice/react`

All hooks and components are Client Components (`'use client'`). Requires `VoiceDuplexProvider` at an ancestor for ConvAI hooks (see below).

### Setup — `VoiceDuplexProvider`

**Required** for `useConversation` and `useVoiceDuplex`. Wraps the ElevenLabs ConvAI SDK context.

```tsx
// app/layout.tsx
import { VoiceDuplexProvider } from '@itsocialist/voice/react'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <VoiceDuplexProvider>{children}</VoiceDuplexProvider>
      </body>
    </html>
  )
}
```

---

### `useVoice(options?): UseVoiceResult`

TTS synthesis and playback.

**Options:**

| Field | Type | Default | Description |
|---|---|---|---|
| `ttsRoute` | `string` | `'/api/tts'` | TTS API route |
| `autoPlay` | `boolean` | `false` | Auto-play when text prop changes |
| `onPlayStart` | `() => void` | — | Called when audio starts |
| `onPlayEnd` | `() => void` | — | Called when audio finishes |
| `onError` | `(error: string) => void` | — | Called on error |

**Returns:**

| Field | Type | Description |
|---|---|---|
| `state` | `'idle' \| 'loading' \| 'playing' \| 'error'` | Current playback state |
| `provider` | `TTSProviderName \| null` | Provider that rendered the last audio |
| `latencyMs` | `number \| null` | Synthesis latency from last call |
| `speak(text, options?)` | `Promise<void>` | Synthesize and play |
| `stop()` | `void` | Stop playback |
| `error` | `string \| null` | Last error message |

`speak()` options: `{ profileKey?, voiceProfile?, provider? }`. `provider: 'browser'` uses Web Speech API (free, no API call).

---

### `useSTT(options): UseSTTResult`

Speech-to-text with browser Web Speech API or server-side Deepgram.

**Options:**

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | `'browser' \| 'server'` | `'browser'` | STT backend |
| `sttRoute` | `string` | `'/api/stt'` | Used when `mode='server'` |
| `language` | `string` | `'en-US'` | Recognition language |
| `onTranscript` | `(text: string) => void` | **required** | Final transcript callback |
| `onInterim` | `(text: string) => void` | — | Partial results (browser mode only) |
| `spacebarHotkey` | `boolean` | `true` | Space bar toggles mic when not in input field |

**Returns:**

| Field | Type | Description |
|---|---|---|
| `state` | `'idle' \| 'listening' \| 'processing' \| 'error'` | Current STT state |
| `interimText` | `string` | Partial transcript (browser mode) |
| `isSupported` | `boolean` | Web Speech API available |
| `micPermission` | `'granted' \| 'denied' \| 'prompt'` | Current mic permission |
| `start()` | `void` | Begin recording |
| `stop()` | `void` | Stop recording |
| `toggle()` | `void` | start/stop toggle |
| `error` | `string \| null` | Last error |

---

### `useConversation(options): UseConversationResult`

Full-duplex real-time voice conversation via ElevenLabs ConvAI. Requires `VoiceDuplexProvider` ancestor.

**Options:**

| Field | Type | Default | Description |
|---|---|---|---|
| `agentRoute` | `string` | `'/api/convai/agent'` | POST route for agent creation |
| `buildConfig` | `() => ConvAIAgentConfig \| Promise<ConvAIAgentConfig>` | **required** | Called at session start to build agent config |
| `onMessage` | `(role: 'agent' \| 'user', text: string) => void` | — | Transcript callback |
| `onStatusChange` | `(status: ConversationStatus) => void` | — | Status transition callback |
| `onError` | `(error: string) => void` | — | Error callback |
| `inputDeviceId` | `string` | — | Mic device ID (H/W selection). Enumerate via `navigator.mediaDevices.enumerateDevices()` |
| `outputDeviceId` | `string` | — | Speaker device ID (H/W selection, SDK-dependent) |

**Returns:**

| Field | Type | Description |
|---|---|---|
| `status` | `ConversationStatus` | See values below |
| `isSpeaking` | `boolean` | `true` when `status === 'agent-speaking'` |
| `agentVolume` | `number` | Output volume level |
| `error` | `string \| null` | Last error message |
| `micPermission` | `MicPermissionState` | Live mic permission — subscribes to OS-level changes |
| `start()` | `Promise<void>` | Calls `buildConfig()`, creates agent, connects |
| `stop()` | `Promise<void>` | Disconnects and cleans up agent |
| `changeInputDevice(deviceId)` | `(string) => Promise<void>` | Switch mic mid-session. On WebRTC, also re-applies SDK audio constraints |
| `changeOutputDevice(deviceId)` | `(string) => Promise<void>` | Switch audio output mid-session |
| `getInputByteFrequencyData?` | `() => Uint8Array` | Mic frequency data for visualizations |
| `getOutputByteFrequencyData?` | `() => Uint8Array` | Output frequency data for visualizations |

`ConversationStatus` values: `'idle' | 'connecting' | 'connected' | 'agent-speaking' | 'user-speaking' | 'disconnecting' | 'error'`

`MicPermissionState` values: `'granted' | 'denied' | 'prompt' | 'unknown'`

`micPermission` subscribes to `navigator.permissions.query({ name: 'microphone' }).onchange` — detects OS-level revocation during active sessions. No-ops safely on browsers without Permissions API (Safari iOS).

**Hardware device selection:**

```tsx
const [inputDeviceId, setInputDeviceId] = useState('')
const devices = await navigator.mediaDevices.enumerateDevices()
const mics = devices.filter(d => d.kind === 'audioinput')

const conv = useConversation({
  buildConfig,
  inputDeviceId: inputDeviceId || undefined,   // empty string → default device
  outputDeviceId: speakerDeviceId || undefined,
})
```

Device labels are only populated after mic permission is granted. Re-enumerate after `micPermission === 'granted'`.

**WebRTC audio quality (since v0.2.1):** when the agent route returns `conversation_token` (WebRTC transport) and `inputDeviceId` is provided, `useConversation` auto-invokes `changeInputDevice` immediately after `onConnect`. This is required because `@elevenlabs/client`'s WebRTC path constructs the LiveKit `Room` with no `audioCaptureDefaults`, so the initial mic track inherits browser defaults (often producing sub-STT-threshold audio on built-in MacBook mics). The SDK's `changeInputDevice` re-acquires the track with `echoCancellation`, `noiseSuppression`, `autoGainControl`, and `channelCount: 1`. WebSocket sessions are unaffected — the WebSocket transport applies these constraints on the initial track already.

**Full usage:**

```tsx
import { useConversation } from '@itsocialist/voice/react'

const conv = useConversation({
  agentRoute: '/api/convai/agent',
  buildConfig: useCallback(() => ({
    systemPrompt: 'You are a sales coach.',
    firstMessage: 'Hi! Ready to practice?',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    agentName: 'Coach',
    turnDetection: { type: 'server_vad', silence_duration_ms: 400 },
  }), []),
  onMessage: (role, text) => addMessage({ role, text }),
})

// Guard for denied mic
if (conv.micPermission === 'denied') return <MicBlockedUI />

return (
  <button onClick={conv.status === 'idle' ? conv.start : conv.stop}>
    {conv.status === 'idle' ? 'Start' : 'End'}
  </button>
)
```

---

### `useVoiceDuplex(options): UseConversationResult`

Provider-agnostic wrapper around `useConversation`. Identical API plus a `provider` field reserved for future provider switching. Currently delegates to ElevenLabs ConvAI.

**Additional option:**

| Field | Type | Default | Description |
|---|---|---|---|
| `provider` | `'elevenlabs' \| 'cartesia' \| 'deepgram'` | `'elevenlabs'` | Reserved — only `'elevenlabs'` is implemented |

Returns the same `UseConversationResult` (including `micPermission`, `inputDeviceId` support, etc.).

Exported types: `UseVoiceDuplexOptions`, `UseVoiceDuplexResult`, `VoiceDuplexProviderName`, `MicPermissionState` (as `VoiceDuplexMicPermission`).

---

### `<AudioPlayer />` Component

Ready-made TTS play/stop button. Uses `useVoice` internally.

```tsx
import { AudioPlayer } from '@itsocialist/voice/react'

<AudioPlayer
  text="Hello world"
  profileKey="narrator"           // OR voiceProfile={explicitProfile}
  provider="elevenlabs"           // optional override
  autoPlay={false}
  ttsRoute="/api/tts"
  onPlayStart={() => {}}
  onPlayEnd={() => {}}
  className="my-class"
/>
```

Props: `text` (required), `profileKey?`, `voiceProfile?`, `provider?`, `autoPlay?` (default `false`), `ttsRoute?` (default `'/api/tts'`), `onPlayStart?`, `onPlayEnd?`, `className?`

---

### `<VoiceInput />` Component

Mic button with Web Speech API STT, spacebar hotkey, and interim transcript preview.

```tsx
import { VoiceInput } from '@itsocialist/voice/react'

<VoiceInput
  onTranscript={(text) => setInput(text)}   // required
  autoSend={true}
  onAutoSend={() => handleSubmit()}
  disabled={isLoading}
  className="my-class"
/>
```

Props: `onTranscript` (required), `autoSend?` (default `false`), `onAutoSend?`, `disabled?` (default `false`), `className?`

Behavior: shows mic-off state if permission denied; shows not-supported state if Web Speech API unavailable; shows interim text balloon during listening.

---

## Architectural Notes

**Agent lifecycle — ephemeral pattern (simple apps):**
1. Client calls POST `/api/convai/agent` with `ConvAIAgentConfig`
2. Server creates agent (3 EL API calls, ~600–900ms)
3. Client connects via `signedUrl` to ElevenLabs WebSocket
4. Client calls DELETE `/api/convai/agent?agent_id=xxx` on session end
5. Server deletes agent (best-effort)

**Agent lifecycle — universal agent pattern (high-concurrency apps):**
1. Server resolves a universal agent once at boot via `resolveUniversalAgent()`
2. Client calls POST `/api/convai/agent` per session
3. Server calls `getSignedUrlWithOverrides()` with per-session overrides (1 EL API call, ~200ms)
4. Client connects; no cleanup needed (universal agent is permanent)

**Hook identity stability:** `buildConfig` should be wrapped in `useCallback` to prevent `useConversation` from treating each render as a new config.

**Mic permission on macOS Chrome:** The hook calls `getUserMedia({ audio: true })` before `startSession()` to capture the permission grant in a user-gesture context. The stream is immediately stopped after the grant; the ElevenLabs SDK opens its own stream. This prevents dual-stream silence on macOS (see COE-S11-001).

---

## Known Limitations

| Area | Limitation |
|---|---|
| ConvAI TTS model | Only `eleven_v3_conversational`, `eleven_flash_v2`, `eleven_turbo_v2` supported by ElevenLabs ConvAI |
| Streaming TTS | `synthesizeSpeechStream` exists but not all providers support true streaming; some fall back to buffered |
| `agentVolume` | Returns `0` or `1` only; real-time volume metering requires SDK-version-specific callbacks not yet abstracted |
| Deepgram STT | Implemented but not battle-tested; fall back to `mode: 'browser'` if issues arise |
| Fish Audio voice IDs | Must be a reference model ID from the Fish Audio console; no built-in voice catalog |
| Output device selection | `outputDeviceId` is forwarded to ElevenLabs SDK `startSession` — effectiveness depends on SDK version |
| Safari iOS | `navigator.permissions.query({ name: 'microphone' })` not supported; `micPermission` stays `'unknown'` |
| ConvAI `cartesia` / `deepgram` | `useVoiceDuplex` `provider` param is reserved; these providers are not yet implemented |

---

## Changelog

Update this section when APIs change. Most recent first.

### 2026-05-09

**Added:**
- `ConvAITurnDetection` interface — VAD config for `ConvAIAgentConfig` and `ConvAISessionOverrides`
- `ConvAIAgentConfig.turnDetection` — pass `{ type: 'server_vad', silence_duration_ms: 400 }` to reduce response lag ~300ms
- `ConvAIAgentConfig.timeoutMs` — all internal `fetch()` calls now apply `AbortSignal.timeout(timeoutMs ?? 15000)`; prevents indefinite Vercel function hangs
- `ConvAISessionOverrides` interface
- `resolveUniversalAgent(name, baseConfig, apiKey?)` — creates universal agent at boot, returns `agentId` for caching
- `getSignedUrlWithOverrides(agentId, overrides, apiKey?)` — 1-call session start (~200ms) replacing 3-call `createConvAIAgent` pattern
- `ConvAIError` class — typed errors with `code` and `status`; replaces plain `new Error(string)` in all ConvAI functions
- `deleteConvAIAgent` now accepts `options?: { apiKey?, onError? }` — pass `onError` for cleanup visibility
- `useConversation` / `useVoiceDuplex` — new return field `micPermission: MicPermissionState` — live OS-level permission monitoring via Permissions API
- `useConversation` / `useVoiceDuplex` options — `inputDeviceId?: string`, `outputDeviceId?: string` for audio H/W device selection
- `ConvAIAgentRouteBody` extended — all optional `ConvAIAgentConfig` fields are now accepted by the handler
- `MicPermissionState` exported from `@itsocialist/voice/react` (also as `VoiceDuplexMicPermission`)
- `next/convai-handler` — maps `ConvAIError.code` to correct HTTP status codes in responses; DELETE now logs cleanup failures

**Fixed:**
- `voice-demo` layout missing `VoiceDuplexProvider` — caused 500 on all ConvAI sessions
