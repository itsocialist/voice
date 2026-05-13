# @itsocialist/voice

Multi-provider voice library for Next.js, Remix, Vite, Node, Bun, and Cloudflare Workers. One unified API for text-to-speech, speech-to-text, and real-time conversational AI — swap providers without rewriting your app.

```
TTS:    ElevenLabs · Cartesia · Fish Audio · OpenAI · Deepgram · Browser
STT:    Deepgram · Browser
ConvAI: ElevenLabs ConvAI (full-duplex; WebSocket via signed_url, WebRTC via conversation_token)
```

---

## Why this exists

Every voice-enabled app reimplements the same plumbing: provider selection, fallback chains, audio playback, mic permission UX, ephemeral ConvAI agent lifecycle. This library extracts that into a single package with a clean API.

**What you get:**

- **Real provider abstraction** — `synthesizeSpeech()` works the same against ElevenLabs, Cartesia, Fish, OpenAI, and Deepgram. The `VoiceRegistry` maps one named identity ("Coach", "Narrator") across all of them.
- **Drop-in Next.js handlers** — three `export { POST, GET }` lines replace your `/api/tts`, `/api/stt`, and `/api/convai/agent` routes.
- **React hooks** — `useVoice`, `useSTT`, `useConversation`, `useVoiceDuplex` handle state, playback, mic permission, and cleanup.
- **ConvAI lifecycle automation** — universal-agent + signed-URL override pattern cuts per-session setup from 3 API calls to 1 (~700ms → ~200ms).
- **Typed errors with retry hints** — `ConvAIError` exposes `type`, `retryable`, and `retryAfterMs` for cross-provider retry logic.
- **Real streaming TTS** — ElevenLabs `/stream` endpoint surfaces as `AsyncIterable<Uint8Array>`. Honest about which providers actually stream (a `supportsStreaming` flag).
- **Browser TTS fallback** — zero-cost local synthesis when no API key is configured.

---

## Providers

### Available today (v0.3.x)

| Provider | Type | Real streaming | Requires env var |
|---|---|---|---|
| [ElevenLabs](https://elevenlabs.io) | TTS + ConvAI | ✅ Yes (`/stream`, ~75ms TTFA) | `ELEVENLABS_API_KEY` |
| [Cartesia](https://cartesia.ai) | TTS (one-shot) | ❌ Buffered today (Sonic WebSocket planned v0.4) | `CARTESIA_API_KEY` |
| [Fish Audio](https://fish.audio) | TTS (one-shot) | ❌ Buffered today | `FISH_AUDIO_API_KEY` |
| [OpenAI](https://platform.openai.com) | TTS (one-shot) | ❌ Buffered today | `OPENAI_API_KEY` |
| [Deepgram](https://deepgram.com) | TTS (one-shot) + STT (one-shot) | ❌ Buffered today (WebSocket planned) | `DEEPGRAM_API_KEY` |
| Browser Web Speech | TTS + STT (client-side) | — (synchronous) | none |

Real streaming means audio chunks arrive incrementally before full synthesis completes. Providers marked ❌ still work for streaming requests — the router wraps `synthesize()` output in a one-chunk stream and emits a loud warning, so consumers know they're not getting sub-second TTFA from those backends.

### Planned multi-backend ConvAI (v0.4+)

The `ConvAIBackend` interface shipped in v0.3.3 is implemented today by ElevenLabs only. Three more backends are targeted:

| Provider | Status | Why it's a planned target |
|---|---|---|
| [Hume EVI 3](https://www.hume.ai) / Octave | v0.4.0 anchor | Empathic axis — beat GPT-4o on 8/9 emotions in blind tests; <300ms voice-to-voice. Strongest fit for sales-sim "buyer persona conveys real emotion" use cases. |
| [Cartesia Line](https://cartesia.ai/agents) | v0.5.0 | Latency winner — Sonic-3.5 ~40-90ms TTFA; Line $0.06/min flat ConvAI. |
| [OpenAI Realtime](https://platform.openai.com/docs/guides/realtime) (`gpt-realtime`) | v0.5.0 | Speech-to-speech single-model architecture + native MCP server support. Right pick when the agent needs heavy tool calling. |

These appear in the `ConvAIProviderId` type union as forward-looking slots (v0.3.4+) so the type system documents the trajectory. Calling `createConvAI({ backend: hume({...}) })` is a v0.4 capability — the import doesn't exist yet.

---

## Install

```bash
npm install @itsocialist/voice
# or
pnpm add @itsocialist/voice
```

**Peer dependencies** (only what you actually use):

```bash
npm install next react react-dom    # if using Next.js handlers and/or React hooks
```

Requires `react@>=18 <20`. The package ships pre-built ESM + CJS with `.d.ts` types — no `transpilePackages` config needed in Next.js or anywhere else.

---

## Quick Start (ConvAI — full-duplex voice agent)

### 1. Set environment variables

```bash
# .env.local
ELEVENLABS_API_KEY=your_key_here
```

### 2. Add the agent route

```ts
// app/api/convai/agent/route.ts
export { POST, DELETE } from '@itsocialist/voice/next/convai-handler'
```

### 3. Wrap your tree in the provider, then call the hook

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

```tsx
// app/coach/page.tsx
'use client'
import { useVoiceDuplex, ELEVENLABS_MODELS } from '@itsocialist/voice/react'

export default function CoachPage() {
  const conv = useVoiceDuplex({
    buildConfig: () => ({
      agent: {
        systemPrompt: 'You are a sales coach. Push back, give honest feedback.',
        firstMessage: 'Hi! Ready to roleplay a cold call?',
        voiceId: 'YOUR_ELEVENLABS_VOICE_ID',
        agentName: 'Sales Coach',
      },
      llm: { model: 'gpt-4o-mini', temperature: 0.7 },
      tts: { modelId: ELEVENLABS_MODELS.FLASH_V2_5, expressiveMode: true },
      vad: { type: 'server_vad', silenceDurationMs: 400 },
      session: { maxDurationSeconds: 1200 },
    }),
    onMessage: (role, text) => console.log(role, ':', text),
  })

  if (conv.micPermission === 'denied') return <p>Mic blocked — check OS settings.</p>

  return (
    <button onClick={conv.status === 'idle' ? conv.start : conv.stop}>
      {conv.status === 'idle' ? 'Start' : 'End'} — {conv.status}
    </button>
  )
}
```

That's the whole integration. The hook handles agent creation, signed-URL fetch, microphone permission, WebSocket / WebRTC connection setup, audio constraint application on macOS, mid-session device switching, and cleanup on stop. Loss of mic permission mid-session surfaces as `conv.micPermission === 'denied'`.

> **Don't forget `VoiceDuplexProvider`** at an ancestor — `useVoiceDuplex` and `useConversation` need it. v0.2.0's voice-demo shipped without it and 500'd on first load.

---

## Quick Start (TTS / STT)

### Register voice profiles once

```ts
// src/lib/voice-profiles.ts
import { voiceRegistry } from '@itsocialist/voice'
import type { VoiceProfile } from '@itsocialist/voice'

const coach: VoiceProfile = {
  name: 'Coach',
  // Set IDs only for providers you actually target — all optional since v0.3.2:
  elevenlabsVoiceId: 'EXAVITQu4vr4xnSDxMaL',
  cartesiaVoiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',
  openaiVoice: 'nova',
}

voiceRegistry.register('coach', coach)
```

Module-scope registration runs once per Node process. In Next.js App Router, do this in a server-only module imported by your root layout — it'll be live by the time any request handler runs.

### Drop in the route handlers

```ts
// app/api/tts/route.ts
export { POST, GET } from '@itsocialist/voice/next/tts-handler'

// app/api/stt/route.ts
export { POST, GET } from '@itsocialist/voice/next/stt-handler'
```

### Use from components

```tsx
import { useVoice, VoiceInput } from '@itsocialist/voice/react'

function SpeakButton() {
  const { state, speak, stop } = useVoice()
  return (
    <button onClick={() => speak('Hello world', { profileKey: 'coach' })}>
      {state}
    </button>
  )
}

function MicInput({ onText }: { onText: (t: string) => void }) {
  return <VoiceInput onTranscript={onText} autoSend />
}
```

### Streaming TTS

```ts
// Server: POST /api/tts?stream=1 returns chunked audio
fetch('/api/tts?stream=1', { method: 'POST', body: JSON.stringify({ text, profileKey: 'coach' }) })

// Programmatic: AsyncIterable, ReadableStream adapter, or legacy .stream
import { synthesizeSpeechStream } from '@itsocialist/voice'

const result = await synthesizeSpeechStream({ text, voiceProfile, format: 'mp3' })

// Compose with for-await
for await (const chunk of result.chunks) { /* ... */ }

// Or pipe to a Response
return new Response(result.toReadableStream(), {
  headers: { 'Content-Type': result.contentType },
})
```

If you call this with a non-streaming provider selected (Cartesia / Fish / OpenAI / Deepgram today), the router wraps the buffered output in a one-chunk stream and emits a loud warning so you know the chunks aren't real.

---

## API reference

### Server / Node — `@itsocialist/voice`

#### TTS

| Export | Purpose |
|---|---|
| `synthesizeSpeech(request)` | One-shot TTS with provider fallback. Returns `{ audioBuffer, contentType, provider, latencyMs }`. |
| `synthesizeSpeechStream(request)` | Streaming TTS with provider fallback. Returns `TTSStreamResponse` with `chunks` (`AsyncIterable<Uint8Array>`), `toReadableStream()`, plus the legacy `stream` field. |
| `getProviderStatus()` | Non-throwing health check. Returns `{ primary: TTSProviderName \| null, available, fallbacks }`. |
| `resetProviders()` | Re-instantiate the provider singleton — useful in tests. |

**Provider selection order:**
1. `request.preferredProvider` (if available)
2. `TTS_PROVIDER` env var (`elevenlabs` / `cartesia` / `fish` / `openai` / `deepgram`)
3. Fallback chain: `cartesia → elevenlabs → deepgram → fish → openai`

If the primary provider throws, the router walks the fallback chain. On every fallback, you get a `console.warn` naming the failed provider.

#### STT

| Export | Purpose |
|---|---|
| `transcribeAudio(request)` | One-shot STT (currently Deepgram-only on the server). Returns `{ transcript, confidence, provider, latencyMs }`. |
| `getSTTStatus()` | Reports STT availability. |

For real-time STT use the Browser Web Speech path via `useSTT({ mode: 'browser' })` — server-side streaming STT is not yet exposed.

#### Voice profile registry

| Export | Purpose |
|---|---|
| `voiceRegistry` | Global `VoiceRegistry` singleton. Most apps use this. |
| `VoiceRegistry` | Class — instantiate `new VoiceRegistry(defaultProfile)` for tests or multi-tenant scenarios. |
| `DEFAULT_VOICE_PROFILE` | Built-in fallback profile (when nothing else matches). |

```ts
voiceRegistry.register('coach', coachProfile)
voiceRegistry.register(['cfo', 'executive'], cfoProfile)  // multiple keys → same profile

voiceRegistry.resolve('coach')              // exact match
voiceRegistry.resolve('The CFO')            // fuzzy match → cfoProfile
voiceRegistry.resolve('unknown')            // → default profile
```

The registry does case-insensitive partial matching. `voiceRegistry.resolve('Champion / Internal Advocate')` will match `'champion'`.

#### ConvAI

| Export | Purpose |
|---|---|
| `createConvAIAgent(config, apiKey?)` | Create an ephemeral agent + return `{ agentId, signedUrl?, conversationToken? }`. Use for per-session agents. |
| `resolveUniversalAgent(name, baseConfig, apiKey?)` | Create a long-lived agent once (cache the promise). Returns `agentId`. |
| `getSignedUrlWithOverrides(agentId, overrides, apiKey?)` | One API call (~200ms) for a session-scoped signed URL with per-session overrides. Pair with `resolveUniversalAgent` to drop per-session setup from 3 API calls to 1. |
| `deleteConvAIAgent(agentId, options?)` | Best-effort agent cleanup on session end. |
| `getSignedUrl(agentId, apiKey?)` | Plain signed URL (no overrides). |
| `ConvAIError` | Typed error with `type` / `code` / `provider` / `retryable` / `retryAfterMs` / `cause`. All ConvAI functions throw this. |
| `ELEVENLABS_MODELS` | Typed model presets: `V3_CONVERSATIONAL`, `FLASH_V2_5`, `TURBO_V2_5`, `FLASH_V2`, `TURBO_V2`. |

**Config shape (v0.3.1+ nested):**

```ts
{
  agent: { systemPrompt, firstMessage, voiceId, agentName },
  llm?:     { model, temperature, maxTokens },         // 'gpt-4o-mini', 'claude-sonnet-4', etc.
  tts?:     { modelId, stability, similarityBoost, expressiveMode, suggestedAudioTags },
  vad?:     { type: 'server_vad', silenceDurationMs, threshold },
  session?: { maxDurationSeconds, timeoutMs },
}
```

The v0.2.x flat shape is still accepted (runtime deprecation warning) — to be removed in v0.4.0. See `BREAKING.md` for the migration.

**Error taxonomy** — `ConvAIError.type` is the provider-neutral category for retry/routing decisions:

| `type` | Meaning | Retryable |
|---|---|---|
| `auth` | API key missing/invalid | No |
| `rate_limit` | Upstream rate limit hit; check `retryAfterMs` | Yes |
| `upstream_unavailable` | 5xx from upstream | Yes |
| `upstream_invalid` | 4xx other than 401/429 | No |
| `config_invalid` | Bad args from caller | No |
| `session_expired` | Signed URL / token expired | No |
| `timeout` | Exceeded `timeoutMs` | Yes |

Existing `err.code === 'ELEVENLABS_UNAVAILABLE'` catches still work — the legacy code strings are preserved unchanged.

---

### Next.js handlers — `@itsocialist/voice/next`

| Route | Verb | Behaviour |
|---|---|---|
| `/api/tts` | `POST` | Returns audio binary. Response headers: `X-TTS-Provider`, `X-TTS-Latency-Ms`, `X-Voice-Name`. |
| `/api/tts?stream=1` | `POST` | Same as above but with `Transfer-Encoding: chunked` and a `ReadableStream` body. |
| `/api/tts` | `GET` | Provider status JSON (always 200, even when nothing configured). |
| `/api/stt` | `POST` | Accepts raw audio binary. Returns `{ transcript, confidence, provider, latencyMs }`. |
| `/api/convai/agent` | `POST` | Body: `ConvAIAgentRouteBody` (nested or flat). Response: `{ agent_id, conversation_token?, signed_url? }`. |
| `/api/convai/agent?agent_id=xxx` | `DELETE` | Cleanup. Always `{ ok: true }`. |

**Custom registry**:

```ts
// app/api/tts/route.ts
import { createTTSHandler } from '@itsocialist/voice/next'
import { myRegistry } from '@/lib/voice-profiles'

export const { POST, GET } = createTTSHandler({ registry: myRegistry })
```

**Browser TTS escape hatch**: send `provider: 'browser'` in the request body and the handler returns `{ useBrowserTTS: true, text }` JSON instead of audio. The client is expected to synthesize via `window.speechSynthesis`.

---

### React — `@itsocialist/voice/react`

All hooks are Client Components (`'use client'` already declared). The `VoiceDuplexProvider` wrapper is required for `useConversation` / `useVoiceDuplex` (ConvAI). The other hooks work without it.

#### `useVoice(options)` — TTS playback

```tsx
const { state, provider, speak, stop } = useVoice({
  ttsRoute: '/api/tts',   // default
  onPlayStart: () => {},
  onPlayEnd: () => {},
})

await speak('Hello world', { profileKey: 'coach' })
await speak('Hello world', { provider: 'cartesia' })     // per-request override
await speak('Hello world', { provider: 'browser' })      // free, local synthesis
```

`state` values: `'idle' | 'loading' | 'playing' | 'error'`.

#### `useSTT(options)` — speech-to-text

```tsx
const { state, interimText, toggle, isSupported, micPermission } = useSTT({
  mode: 'browser',                       // 'browser' (Web Speech) | 'server' (Deepgram)
  onTranscript: (text) => setInput(text),
  onInterim:    (text) => setPreview(text),
  spacebarHotkey: true,
})
```

#### `useConversation(options)` / `useVoiceDuplex(options)` — full-duplex ConvAI

```tsx
const conv = useConversation({
  agentRoute: '/api/convai/agent',
  buildConfig: () => ({ /* nested ConvAIAgentConfig */ }),
  onMessage: (role, text) => {},
  onStatusChange: (status) => {},
  onError: (error) => {},
  inputDeviceId, outputDeviceId,         // mid-session swap supported
})

// Return value:
conv.status                              // 'idle' | 'connecting' | 'connected' | 'agent-speaking' | 'user-speaking' | 'disconnecting' | 'error'
conv.isSpeaking
conv.agentVolume                         // 0 / 1 today (real FFT bands in v0.4 — see backlog)
conv.error
conv.micPermission                       // 'granted' | 'denied' | 'prompt' | 'unknown'
conv.start()
conv.stop()
conv.changeInputDevice(deviceId)         // mid-session mic swap
conv.changeOutputDevice(deviceId)
conv.getInputByteFrequencyData?.()       // Uint8Array of mic frequency bins
conv.getOutputByteFrequencyData?.()      // Uint8Array of agent frequency bins
```

`useVoiceDuplex` is a thin wrapper over `useConversation` reserved for future provider switching (`provider: 'elevenlabs' | 'cartesia' | 'deepgram'` — only `elevenlabs` implemented today).

#### Components

```tsx
<AudioPlayer text="Hello" profileKey="coach" autoPlay={false} />
<VoiceInput onTranscript={setInput} autoSend />
<VoiceDuplexProvider>{children}</VoiceDuplexProvider>
```

---

## VoiceProfile shape

```ts
interface VoiceProfile {
  name: string

  // Per-provider IDs — all optional since v0.3.2.
  // Set only the ones your app targets.
  elevenlabsVoiceId?: string
  fishModelId?:       string
  openaiVoice?:       'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  cartesiaVoiceId?:   string
  deepgramVoiceId?:   string

  gender?:   'male' | 'female'
  ageRange?: 'young' | 'middle' | 'senior'
  style?:    string

  elevenlabsSettings?: {
    stability: number          // 0.0–1.0  lower = more expressive
    similarity_boost: number   // 0.0–1.0  higher = more faithful to voice
    style: number              // 0.0–1.0  higher = more dramatic
    use_speaker_boost: boolean
  }
  fishSettings?: {
    temperature: number        // 0.0–1.0
    top_p:       number        // 0.0–1.0
    speed:       number        // 0.5–2.0
  }
}
```

If you route a request to a provider whose required ID is missing on the profile, the provider throws a clear error message pointing at the field. Defaults apply where reasonable (OpenAI falls back to `'nova'`).

---

## ConvAI lifecycle patterns

### Per-session ephemeral agent

```ts
const agent = await createConvAIAgent({
  agent: { systemPrompt, firstMessage, voiceId, agentName },
})
// Use agent.signedUrl or agent.conversationToken; call deleteConvAIAgent(agent.agentId) on session end.
```

3 API calls (~700ms): create-agent + signed-URL + conversation-token.

### Universal agent + per-session overrides (recommended for high concurrency)

```ts
// At server boot:
let agentIdPromise: Promise<string> | null = null
const getAgent = () => (agentIdPromise ??= resolveUniversalAgent('MyApp', BASE_CONFIG))

// Per session:
const agentId = await getAgent()
const result = await getSignedUrlWithOverrides(agentId, {
  agent: { systemPrompt: personalisedPrompt, voiceId: pickedVoice },
})
```

1 API call per session (~200ms). For SpeakerHero-class apps this is the lever that cut per-session setup latency.

> **Note on per-session overrides**: ElevenLabs requires the agent's workspace-level `overrides.conversation_config_override.agent.prompt.*` permissions to be set to `true` in the dashboard. Default is `false`. Toggle on the fields you want to override per-session.

---

## Forking for your own needs

This library is intentionally thin — it has no opinion about your voice profiles, routes, or UI. To customize:

```bash
gh repo fork itsocialist/voice --clone
cd voice
```

Then:
1. Add your voice profiles to `src/profiles/defaults.ts` (or use the global `voiceRegistry`)
2. Extend `VoiceProfile` in `src/types.ts` if you need extra fields
3. Customize the React components in `react/components/` for your design system

---

## Known limitations

- **Cartesia / Deepgram TTS streaming** — buffered today. WebSocket endpoints planned for v0.4. `supportsStreaming: false` on these providers.
- **`agentVolume`** returns 0 / 1 only — a legacy quirk of the underlying SDK. Use the v0.4.2 visualization hooks (`useInputLevel`, `useOutputLevel`, `useInputBands`, `useOutputBands`) or drop-in components (`<VoiceWaveform>`, `<VoiceMeter>`) for real frequency-band UIs.
- **Auto-reconnect on transient WebRTC drops** — not yet implemented (RQ-10). Sessions die silently on network blips. Planned for v0.4.
- **Multi-backend ConvAI** — ElevenLabs is the only ConvAI backend today. Provider-neutral abstraction (`createConvAI({ backend: ... })`) lands in v0.3.3 with the same `elevenlabs` impl behind it. Hume EVI 3 / Cartesia Line / OpenAI Realtime targeted for v0.4–v0.5.

---

## Release history

See [CHANGELOG.md](./CHANGELOG.md) for the full per-release notes and [BREAKING.md](./BREAKING.md) for the migration paths between major bumps.

| Version | Theme |
|---|---|
| v0.1.0 | Initial release — multi-provider TTS/STT, ConvAI on ElevenLabs |
| v0.2.0–v0.2.4 | SpeakerHero-driven cycle: typed errors, device selection, mic permission, universal-agent pattern, expressive tags, LLM model selection |
| v0.3.0 | Foundation — `tsup` build, dist/ ESM + CJS, CI, BREAKING.md |
| v0.3.1 | Surface cleanup — nested `ConvAIAgentConfig` ({ agent, llm, tts, vad, session }), camelCase VAD, error taxonomy refactor |
| v0.3.2 | Streaming truth — `AsyncIterable` canonical, fake `synthesizeStream` removed from Cartesia/Deepgram, `getProviderStatus()` non-throwing, VoiceProfile widening |
| v0.3.3 | ConvAI backend abstraction skeleton + barge-in API |

---

## License

MIT
