# Changelog

All notable changes to `@itsocialist/voice` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.3.1] — 2026-05-12

### Summary

Workstream B surface-cleanup, slice 1: config shape subdivision,
camelCase wire-leak fix on `turnDetection`, and the `ConvAIError`
taxonomy refactor recommended by the API/SDK design review. All three
are technically breaking but bundled into a single release with one-cycle
backward compatibility (deprecation warnings, not hard errors) so
consumers can migrate at their own pace before v0.4.0.

The v0.3.x cycle continues — Workstream B slice 2 (VoiceProfile
symmetry, `getProviderStatus` non-throw, real streaming, barge-in API)
ships in v0.3.2.

### Added

- **Nested `ConvAIAgentConfig` shape** — canonical from v0.3.1+:
  ```ts
  {
    agent: { systemPrompt, firstMessage, voiceId, agentName },
    llm?: { model, temperature, maxTokens },
    tts?: { modelId, stability, similarityBoost, expressiveMode, suggestedAudioTags },
    vad?: { type, silenceDurationMs, threshold },
    session?: { maxDurationSeconds, timeoutMs },
  }
  ```
  Subdivided into five concern groups (agent / llm / tts / vad / session)
  to keep the config from becoming a kitchen-sink. v0.2.x flat shape
  still accepted on input with a one-time deprecation warning per
  process. Public type is a union: `ConvAIAgentConfigNested | ConvAIAgentConfigFlat`.

- **`ConvAITurnDetection.silenceDurationMs`** — camelCase alternative
  to the snake-case `silence_duration_ms` wire field (which leaked
  through from the ElevenLabs API shape). Both accepted; snake-case
  emits a deprecation warning. Snake-case removed in v0.4.0.

- **`ConvAIError` carries `type`, `retryable`, `retryAfterMs`, `cause`** —
  richer taxonomy for retry-routing and provider-neutral error handling.
  `type` is the canonical category axis (`'auth' | 'rate_limit' |
  'upstream_unavailable' | 'upstream_invalid' | 'config_invalid' |
  'session_expired' | 'timeout'`). When upstream returns `Retry-After`,
  the header is parsed into `retryAfterMs`. `cause` is populated when
  the error wraps an underlying exception.

  Legacy `code` field preserved unchanged — existing
  `err.code === 'ELEVENLABS_UNAVAILABLE'` catch blocks still work. Both
  the v0.2.x positional constructor (`new ConvAIError(code, message, status?)`)
  and the new options-object constructor are supported.

- **Public exports** — `ConvAIAgentConfigNested`, `ConvAIAgentConfigFlat`,
  `ConvAIAgentIdentity`, `ConvAITTSConfigGroup`, `ConvAISessionPolicy`,
  `ConvAISessionOverridesNested`, `ConvAISessionOverridesFlat`,
  `ConvAIErrorType`, `ConvAIProviderId`, `ConvAILegacyCode`,
  `ConvAIErrorDetails`.

### Changed

- **`ConvAIAgentRouteBody`** is now a type alias for `ConvAIAgentConfig`
  (the union of nested and flat). The Next ConvAI route handler passes
  the body straight through to `createConvAIAgent` after light required-field
  validation; both shapes work in the route body.

- **Next ConvAI handler HTTP status mapping** now reads `error.type`
  (the canonical retry-routing axis):
  - `type: 'auth'` → 500
  - `type: 'upstream_unavailable'` → 503
  - `type: 'rate_limit'` → 429
  - `type: 'config_invalid'` → 400
  - default → `error.status ?? 500`

  Response body includes `code`, `type`, and `retryable` so consumers
  can act on the new fields without parsing strings.

- **`tsconfig.json`** target/lib bumped to ES2022 (was ES2020) to
  enable `Error(message, { cause })` constructor support. Built output
  remains broadly compatible — esbuild downlevels where needed.

### Deprecated (one-cycle back-compat, removed in v0.4.0)

- **Flat-shape config input** on `createConvAIAgent`, `resolveUniversalAgent`,
  `getSignedUrlWithOverrides`. Emits one warning per process keyed
  per call-site. Migrate to nested shape.

- **`ConvAITurnDetection.silence_duration_ms`** — rename to
  `silenceDurationMs`.

### Migration notes

For consumers staying on v0.2.x flat shape:
```ts
// v0.2.x — still works in v0.3.1, deprecation warning at runtime:
await createConvAIAgent({
  systemPrompt, firstMessage, voiceId, agentName,
  modelId: 'eleven_flash_v2_5',
  llm: { model: 'gpt-4o-mini' },
  turnDetection: { type: 'server_vad', silence_duration_ms: 400 },
});
```

For consumers adopting the nested shape:
```ts
// v0.3.1+ canonical:
await createConvAIAgent({
  agent: { systemPrompt, firstMessage, voiceId, agentName },
  llm: { model: 'gpt-4o-mini' },
  tts: { modelId: ELEVENLABS_MODELS.FLASH_V2_5 },
  vad: { type: 'server_vad', silenceDurationMs: 400 },
  session: { maxDurationSeconds: 1200 },
});
```

See [BREAKING.md](./BREAKING.md) for the full migration path.

---

## [0.3.0] — 2026-05-12

### Summary

Foundational release — moves the package from shipping raw TypeScript source
(`main: ./src/index.ts`) to a pre-built dual ESM + CJS `dist/` with
`.d.ts` / `.d.cts` types and a conditional `exports` map. v0.2.x worked in
Next.js only (which compiles dependencies); v0.3.0 works in any modern
JavaScript runtime — Node ESM/CJS, Vite SSR, Bun, Cloudflare Workers, Deno
(via npm:), Remix, Astro, plain bundlers.

**Public API is unchanged** — every exported function, type, component, and
hook from v0.2.4 still exports from v0.3.0 with the same signature. Only the
resolution mechanism changed.

This is the foundation slice of the v0.3.x cycle. Subsequent v0.3.x releases
will add the surface-cleanup workstream (config subdivision, error taxonomy
refactor, camelCase normalization, real streaming, barge-in API) and the
multi-backend ConvAI abstraction skeleton.

See [BREAKING.md](./BREAKING.md) for migration notes.

### Changed

- **Build pipeline**: `tsup` replaces `tsc` for the distribution build. Emits
  `dist/index.{js,cjs,d.ts,d.cts}` plus `dist/next/*` and `dist/react/index.*`
  in both ESM and CJS formats. Source maps are intentionally disabled — they
  would reference `../src/*.ts` paths that aren't shipped.

- **`package.json`** now declares `"type": "module"` with explicit `main`,
  `module`, `types`, and a full conditional `exports` map. Deep imports
  documented in the README (`./next/tts-handler`, `./next/stt-handler`,
  `./next/convai-handler`, `./next`, `./react`) all resolve as expected
  from both ESM and CJS consumers.

- **`files` whitelist** simplified to `dist/`, the three docs (`README.md`,
  `CHANGELOG.md`, `BREAKING.md`), and `agent.md`. Previous versions shipped
  raw `src/`, `next/`, `react/` source — those are no longer in the tarball.

- **React peer dependency** capped at `>=18 <20`. v0.2.x's `>=18.0.0` would
  silently accept React 20+ without us having tested against it.

- **CI workflow** added at `.github/workflows/ci.yml`. Runs on push/PR to
  `main` across Node 20.x and 22.x. Steps: typecheck, build, verify all
  expected `dist/` files emitted, verify server entry has no React in its
  module graph, ESM + CJS + deep-import smoke tests, vitest.

### Fixed

- Server entry (`dist/index.{js,cjs}`) is now verified clean of React imports
  by a CI check. Earlier versions had no enforcement preventing accidental
  React leakage into the server module graph.

---

## [0.2.4] — 2026-05-12

### Summary

Ships SpeakerHero RQ-12 — exposing the ConvAI LLM model so consumers can pick
something faster than ElevenLabs' default. Lands in the **nested config shape**
(`llm: { model, temperature, maxTokens }`) rather than flat top-level fields, on
the recommendation of the API/SDK design review. This sets v0.2.x on the path to
the v0.3.0 fully-subdivided config layout (`agent / llm / tts / vad / session`)
and means consumers won't have to migrate `llmModel` → `llm.model` three weeks
from now.

Verified against the live ElevenLabs API on 2026-05-12: `llm`, `temperature`,
and `max_tokens` fields are all accepted by `POST /v1/convai/agents/create` and
echoed back correctly on subsequent GET. The most useful starting point for
sub-second per-turn latency is `'gpt-4o-mini'`.

### Added

- `ConvAILLMConfig` interface — `{ model?, temperature?, maxTokens? }`. Exported
  from `@itsocialist/voice`.

- `ConvAIAgentConfig.llm?: ConvAILLMConfig` — agent-level LLM selection. Maps to
  `conversation_config.agent.prompt.{llm, temperature, max_tokens}`. When omitted,
  ElevenLabs picks its account default (typically `gpt-4o-mini`).

- `ConvAISessionOverrides.llm?: ConvAILLMConfig` — per-session LLM override on
  the universal-agent path (`getSignedUrlWithOverrides`). Override is only
  honored if the agent's `overrides.conversation_config_override.agent.prompt`
  permissions allow it; otherwise ElevenLabs falls back to the agent's
  base config. Configure the permissions in the ElevenLabs dashboard.

- `ConvAIAgentRouteBody.llm` — Next handler forwards the field unchanged.

### Changed

- `createConvAIAgent` and `resolveUniversalAgent` now both share an internal
  `buildPromptPayload` helper, mirroring the pattern established by
  `buildTtsPayload` in v0.2.2. Keeps the API request shape consistent across
  all three call sites (`createConvAIAgent`, `resolveUniversalAgent`,
  `getSignedUrlWithOverrides`).

### Usage

```ts
import { createConvAIAgent, ELEVENLABS_MODELS } from '@itsocialist/voice';

await createConvAIAgent({
  systemPrompt,
  firstMessage,
  voiceId,
  agentName: 'Sales Coach',
  // RQ-12 — pick the LLM:
  llm: {
    model: 'gpt-4o-mini',    // or 'gpt-4o', 'claude-sonnet-4', 'gemini-2.0-flash'
    temperature: 0.7,
    maxTokens: 800,
  },
  // RQ-11 still available:
  expressiveMode: true,
  suggestedAudioTags: ['curious', 'skeptical'],
  // Existing TTS knob unchanged:
  modelId: ELEVENLABS_MODELS.V3_CONVERSATIONAL,
});
```

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

[Unreleased]: https://github.com/itsocialist/voice/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/itsocialist/voice/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/itsocialist/voice/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/itsocialist/voice/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/itsocialist/voice/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/itsocialist/voice/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/itsocialist/voice/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/itsocialist/voice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/itsocialist/voice/releases/tag/v0.1.0
