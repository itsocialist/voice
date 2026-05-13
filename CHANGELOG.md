# Changelog

All notable changes to `@itsocialist/voice` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.3] — 2026-05-12

### Summary

Adds typed `ELEVENLABS_MODELS` preset constants so consumers can pick the ConvAI
TTS model from a discoverable, autocomplete-friendly enum instead of memorising
magic strings. Also fixes a long-standing scope-name inconsistency where several
internal files referenced `@briandawson/voice` (the previous scope) instead of
`@itsocialist/voice`.

### Added

- `ELEVENLABS_MODELS` constants and `ElevenLabsModelId` type, exported from
  `@itsocialist/voice`. Maps to the current ElevenLabs ConvAI model family with
  inline latency/expressiveness tradeoffs documented at [src/convai/models.ts](src/convai/models.ts):

  ```ts
  import { createConvAIAgent, ELEVENLABS_MODELS } from '@itsocialist/voice';

  await createConvAIAgent({
    modelId: ELEVENLABS_MODELS.FLASH_V2_5,  // realtime, ~75ms TTFA
    // …
  });
  ```

  `modelId` on `ConvAIAgentConfig` stays `string` — the constants narrow IDE
  autocomplete without locking the type. Pass any other identifier ElevenLabs
  supports.

### Fixed

- Internal references to `@briandawson/voice` updated to `@itsocialist/voice`
  across [tsconfig.json](tsconfig.json), [next/tts-handler.ts](next/tts-handler.ts),
  [next/index.ts](next/index.ts), [react/index.ts](react/index.ts),
  [src/index.ts](src/index.ts), [src/types.ts](src/types.ts), and
  [src/profiles/registry.ts](src/profiles/registry.ts). Surface-level only — no
  runtime behaviour change. Flagged by independent consumer-developer and
  API/SDK-design review.

---

## [0.2.2] — 2026-05-12

### Summary

Addresses SpeakerHero RQ-11. The ConvAI client now forwards
`expressive_mode` and `suggested_audio_tags` to the ElevenLabs API. Together
these eliminate the failure mode where v3 models invent emotional tags like
`[interested]` / `[analytical]` and the bracketed strings get spoken aloud
instead of being interpreted as performance cues. SpeakerHero can now retire
its prompt-level "don't invent tags" instruction and the transcript regex scrub.

### Added

**ConvAI — server/Node**

- `ConvAIAgentConfig.expressiveMode?: boolean` — enables ElevenLabs' expressive
  audio-tag prompt augmentation. Defaults to `true` when `modelId` is a v3
  family model (`eleven_v3*`), `false` otherwise. ElevenLabs silently no-ops
  this field on non-v3 models, so passing it is always safe.

- `ConvAIAgentConfig.suggestedAudioTags?: ConvAISuggestedAudioTag[]` —
  constrains the LLM to a preferred set of audio tags (max 20). Each entry is
  either a plain string (`"thoughtful"`) or an object with a usage hint
  (`{ tag: "thoughtful", description: "When considering a tradeoff" }`).

- Both fields also accepted as per-session overrides on
  `ConvAISessionOverrides` (passed to `getSignedUrlWithOverrides`), and
  forwarded through `ConvAIAgentRouteBody` so they propagate from the Next.js
  route handler down to the API call.

- `ConvAISuggestedAudioTag` type — `string | { tag: string; description?: string }`.

### Changed

- `createConvAIAgent` and `resolveUniversalAgent` now both share an internal
  `buildTtsPayload` helper so the TTS request shape stays in sync across
  call sites.

---

## [0.2.1] — 2026-05-12

### Summary

Addresses SpeakerHero's round-2 briefing (RQ-08 partial, RQ-09 full). Two SDK quirks
discovered during the feasibility pass and worked around inside the library so
consumers no longer need to reach into `@elevenlabs/react` internals.

### Added

**React hooks (`@itsocialist/voice/react`)**

- `useConversation` / `useVoiceDuplex` return `changeInputDevice(deviceId)` and
  `changeOutputDevice(deviceId)` — direct forwards to the underlying SDK methods.
  Lets consumers switch audio hardware mid-session without depending on
  `@elevenlabs/react`'s `useConversationControls` (RQ-09).

- Agent route may now return `conversation_token` (WebRTC transport) in addition
  to `signed_url` (WebSocket transport). The hook selects the transport
  automatically. `signed_url` still takes precedence if both are returned —
  backward compatible with v0.2.0 consumers.

### Fixed

- **WebRTC initial mic track now gets correct audio constraints** (RQ-08, partial).
  The `@elevenlabs/client` WebRTC path constructs the LiveKit `Room` with no
  `audioCaptureDefaults`, so the first mic track inherits browser defaults —
  producing sub-STT-threshold audio on built-in MacBook microphones. The SDK's
  own `changeInputDevice` *does* apply correct constraints (echoCancellation,
  noiseSuppression, autoGainControl, channelCount: 1), so `useConversation` now
  auto-invokes it immediately after `onConnect` when both the transport is WebRTC
  and `inputDeviceId` is set. WebSocket sessions are unaffected — the WebSocket
  path already applies these constraints internally.

  Full custom-constraints support requires an upstream SDK change to accept
  `audioCaptureDefaults` on the `Room` constructor; an issue will be filed
  against `@elevenlabs/client`.

---

## [0.2.0] — 2026-05-09

### Summary

This release addresses all six requests filed by SpeakerHero (2026-05-09) and adds audio hardware device selection. The headline change is a new **universal agent + signed-URL override** pattern that reduces per-session ConvAI startup from ~700ms to ~200ms and eliminates the need for direct ElevenLabs API calls in consuming apps. Typed error classes, configurable timeouts, VAD turn detection, and live mic permission monitoring round out the P0–P2 items.

### Added

**ConvAI — server/Node (`@itsocialist/voice`)**

- `resolveUniversalAgent(name, baseConfig, apiKey?)` — creates a long-lived universal agent once at server boot; returns `agentId` for the caller to cache. Designed for module-scope lazy initialization (`agentIdPromise ??= resolveUniversalAgent(...)`).

- `getSignedUrlWithOverrides(agentId, overrides, apiKey?)` — fetches a signed URL for an existing universal agent with per-session `ConvAISessionOverrides` (1 ElevenLabs API call, ~200ms). Replaces the 3-call `createConvAIAgent` pattern in high-concurrency routes.

- `ConvAISessionOverrides` interface — `{ systemPrompt?, firstMessage?, voiceId?, turnDetection? }` passed to `getSignedUrlWithOverrides`.

- `ConvAIError` class — typed error with `code: 'API_KEY_MISSING' | 'AGENT_CREATION_FAILED' | 'SIGNED_URL_FAILED' | 'ELEVENLABS_UNAVAILABLE' | 'OVERRIDE_FAILED'` and optional upstream `status: number`. All ConvAI functions now throw `ConvAIError` instead of plain `Error`, enabling clean HTTP status mapping in route handlers.

- `ConvAITurnDetection` interface — `{ type: 'server_vad', silence_duration_ms?, threshold? }`. Reduces perceived turn-handoff latency by ~300ms when `silence_duration_ms: 400`.

- `ConvAIAgentConfig.turnDetection` — VAD config applied at agent creation.

- `ConvAIAgentConfig.timeoutMs` — `AbortSignal.timeout()` applied to every internal `fetch()` call. Default `15000`. Prevents indefinite Vercel function hangs when ElevenLabs is slow.

- `deleteConvAIAgent` `options.onError` — optional `(err: Error) => void` callback instead of silent swallow. Callers that want best-effort behavior pass nothing; callers that want cleanup visibility pass a logger.

- `ConvAISessionOverrides`, `ConvAITurnDetection` exported from `@itsocialist/voice`.

- `ConvAIError` exported from `@itsocialist/voice`.

**React hooks (`@itsocialist/voice/react`)**

- `useConversation` / `useVoiceDuplex` return `micPermission: 'granted' | 'denied' | 'prompt' | 'unknown'` — subscribes to `navigator.permissions.query({ name: 'microphone' }).onchange` on mount; detects OS-level mic revocation during active sessions. No-ops safely on Safari iOS.

- `useConversation` / `useVoiceDuplex` options accept `inputDeviceId?: string` and `outputDeviceId?: string` — audio hardware device selection. `inputDeviceId` is passed to `getUserMedia` and forwarded to ElevenLabs SDK `startSession`. Enumerate devices with `navigator.mediaDevices.enumerateDevices()` after `micPermission === 'granted'`.

- `MicPermissionState` type exported from `@itsocialist/voice/react` (also as `VoiceDuplexMicPermission` from the `useVoiceDuplex` re-export).

**Next.js handler (`@itsocialist/voice/next`)**

- `ConvAIAgentRouteBody` extended with all optional `ConvAIAgentConfig` fields: `maxDurationSeconds`, `modelId`, `stability`, `similarityBoost`, `turnDetection`, `timeoutMs`. All are forwarded to `createConvAIAgent`.

- ConvAI handler now catches `ConvAIError` and maps `code` → HTTP status (`ELEVENLABS_UNAVAILABLE` → 503, `API_KEY_MISSING` → 500, others → upstream status or 500). Error response includes `code` field.

- ConvAI DELETE handler now passes `onError` to `deleteConvAIAgent` and logs cleanup failures via `console.warn`.

**Documentation**

- `agent.md` — machine-readable LLM reference covering all exported symbols, types, defaults, constraints, both agent lifecycle patterns, and known limitations. Intended to be committed and updated alongside code.

### Fixed

- `voice-demo` `app/layout.tsx` missing `VoiceDuplexProvider` wrapper — caused 500 on all ConvAI page loads.

---

## [0.1.0] — 2026-04-xx

Initial public release.

### Added

- **TTS** — multi-provider synthesis: ElevenLabs, Fish Audio, OpenAI TTS, Cartesia, Deepgram, Browser Web Speech
- **TTS streaming** — `synthesizeSpeechStream()` / `synthesizeStream()` on providers that support it (Cartesia REST stream, ElevenLabs)
- **STT** — Deepgram server-side and Browser Web Speech API
- **ConvAI** — ElevenLabs ConvAI full-duplex real-time conversation via WebSocket / WebRTC
  - `createConvAIAgent()` — ephemeral agent per session
  - `deleteConvAIAgent()` — best-effort cleanup
  - `getSignedUrl()` — signed URL for existing agent
  - Parallel token + signed URL fetch to minimize setup latency
  - TTS model: `eleven_v3_conversational` (Scribe v2 Realtime with emotional cues, upgraded May 2026)
- **VoiceRegistry** — maps named voice identities across all TTS providers with fuzzy matching; global singleton + custom instance
- **`DEFAULT_VOICE_PROFILE`** — fallback profile when registry key is not found
- **Next.js App Router handlers** — drop-in `route.ts` exports for TTS (`POST`, `GET`), STT (`POST`, `GET`), ConvAI (`POST`, `DELETE`)
- **`createTTSHandler({ registry })`** — factory for custom registry injection
- **React hooks** — `useVoice`, `useSTT`, `useConversation`, `useVoiceDuplex`
- **React components** — `<AudioPlayer />`, `<VoiceInput />`, `<VoiceDuplexProvider />`
- **`useVoiceDuplex`** — provider-agnostic abstraction over `useConversation`; `provider` param reserved for future Cartesia / Deepgram swap
- **macOS dual-stream fix** — `getUserMedia` permission check stream stopped before ElevenLabs SDK stream opens (COE-S11-001)
- **ElevenLabs React SDK v1.x integration** — `ConversationProvider` context via `VoiceDuplexProvider`
- TypeScript types throughout; no runtime dependencies beyond `@elevenlabs/react` and `@elevenlabs/client`

[Unreleased]: https://github.com/itsocialist/voice/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/itsocialist/voice/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/itsocialist/voice/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/itsocialist/voice/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/itsocialist/voice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/itsocialist/voice/releases/tag/v0.1.0
