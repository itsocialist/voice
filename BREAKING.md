# Breaking changes

This file tracks every breaking change shipped between major-bump releases.
For the additive changes that ride alongside, see [CHANGELOG.md](./CHANGELOG.md).

---

## v0.3.1 — 2026-05-12

Workstream B surface-cleanup, slice 1. Three breakages bundled with
one-cycle backward compatibility (deprecation warnings at runtime, hard
removal in v0.4.0).

### 1. `ConvAIAgentConfig` shape subdivided into nested groups

**What changed**

v0.2.x had all 12+ optional fields at the top level of `ConvAIAgentConfig`.
With RQ-12 (LLM selection) adding three more in v0.2.4 and RQ-11 adding two
in v0.2.2, the shape was sliding toward the kitchen-sink anti-pattern that
turned OpenAI's `ChatCompletion` config into a maintenance burden over years.

v0.3.1 introduces a nested shape with five concern groups:

```ts
{
  agent: { systemPrompt, firstMessage, voiceId, agentName },
  llm?: { model, temperature, maxTokens },
  tts?: { modelId, stability, similarityBoost, expressiveMode, suggestedAudioTags },
  vad?: { type, silenceDurationMs, threshold },
  session?: { maxDurationSeconds, timeoutMs },
}
```

**Backward compatibility**

The v0.2.x flat shape is still accepted for v0.3.x. `createConvAIAgent`,
`resolveUniversalAgent`, and `getSignedUrlWithOverrides` normalize either
shape internally. Flat input emits one `console.warn` per process:

```
[voice-lib] DEPRECATION: Flat ConvAIAgentConfig shape (systemPrompt, modelId,
etc. at the top level) is deprecated. Move to nested shape ...
before v0.4.0 — flat shape will be removed then.
```

**What you need to do**

Update your `createConvAIAgent` / `resolveUniversalAgent` /
`getSignedUrlWithOverrides` call sites to use the nested shape before v0.4.0:

```diff
- await createConvAIAgent({
-   systemPrompt,
-   firstMessage,
-   voiceId,
-   agentName,
-   maxDurationSeconds: 1200,
-   modelId: 'eleven_flash_v2_5',
-   stability: 0.5,
-   similarityBoost: 0.75,
-   turnDetection: { type: 'server_vad', silence_duration_ms: 400 },
-   timeoutMs: 15000,
-   expressiveMode: true,
-   suggestedAudioTags: ['curious'],
-   llm: { model: 'gpt-4o-mini', temperature: 0.7 },
- });
+ await createConvAIAgent({
+   agent: { systemPrompt, firstMessage, voiceId, agentName },
+   session: { maxDurationSeconds: 1200, timeoutMs: 15000 },
+   tts: {
+     modelId: 'eleven_flash_v2_5',
+     stability: 0.5,
+     similarityBoost: 0.75,
+     expressiveMode: true,
+     suggestedAudioTags: ['curious'],
+   },
+   vad: { type: 'server_vad', silenceDurationMs: 400 },
+   llm: { model: 'gpt-4o-mini', temperature: 0.7 },
+ });
```

Same shape works on the POST body of `/api/convai/agent` if you're consuming
through `@itsocialist/voice/next/convai-handler`.

### 2. `ConvAITurnDetection.silence_duration_ms` → `silenceDurationMs`

**What changed**

The snake-case `silence_duration_ms` field was the ElevenLabs API wire
format leaking through into voice-lib's public TypeScript surface — a
"wire-format leak" called out by the SDK design review. v0.3.1 introduces
the camelCase alternative; the snake-case form is accepted with a
deprecation warning.

**What you need to do**

Rename the field:

```diff
  vad: {
    type: 'server_vad',
-   silence_duration_ms: 400,
+   silenceDurationMs: 400,
  }
```

The translation to the upstream wire format (`silence_duration_ms`) happens
internally; you don't need to think about it.

### 3. `ConvAIError` taxonomy refactor

**What changed**

The `ConvAIError` class gained four new fields:

- `type: ConvAIErrorType` — provider-neutral error category for retry-routing
- `provider: ConvAIProviderId` — which backend produced the error
  (`'elevenlabs'` is the only value in v0.3.x)
- `retryable: boolean` — explicit retry hint
- `retryAfterMs?: number` — populated from upstream `Retry-After` headers
  (mainly for 429 rate-limit responses)
- `cause?: unknown` — ES2022 standard error chaining

**Backward compatibility**

The legacy `code` field is unchanged. Existing catches like:

```ts
catch (e) {
  if (e instanceof ConvAIError && e.code === 'ELEVENLABS_UNAVAILABLE') { ... }
}
```

continue to work. The v0.2.x positional constructor
(`new ConvAIError(code, message, status?)`) also still works for any code
in your codebase that constructs the error directly (e.g. test mocks).

**Recommended migration**

Move retry-routing logic from `code`-string-matching to the new `type` /
`retryable` fields:

```diff
  catch (e) {
    if (e instanceof ConvAIError) {
-     if (e.code === 'ELEVENLABS_UNAVAILABLE') {
-       await backoff();
-       return retry();
-     }
+     if (e.retryable) {
+       const delay = e.retryAfterMs ?? backoffMs();
+       await sleep(delay);
+       return retry();
+     }
    }
  }
```

This positions your code for v0.4+ when additional backends (Hume,
Cartesia Line, OpenAI Realtime) join — those errors will populate `type`
and `retryable` from their own status codes, and your retry logic will
work uniformly across all backends.

### 4. `tsconfig.json` target/lib bumped ES2020 → ES2022

**What changed**

Required to support `Error(message, { cause })` (ES2022). Built output is
still broadly compatible; esbuild downlevels syntax where needed.

**What you need to do**

Nothing for runtime consumers. If you're a fork or you `tsc` against the
source, ensure your `lib` supports ES2022.

---

## v0.3.0 — 2026-05-12

### 1. Package layout: pre-built `dist/` instead of raw TypeScript source

**What changed**

v0.2.x shipped `src/**/*.ts` (and `react/**/*.tsx`, `next/**/*.ts`) as the
package contents, with `"main": "./src/index.ts"`. Consumers had to be in a
toolchain that could compile TypeScript on the fly — Next.js worked because
Next compiles dependencies in `transpilePackages`; plain Node, Remix, Vite SSR,
Bun, Cloudflare Workers, and other environments all failed.

v0.3.0 ships a pre-built `dist/` directory with:

- ESM (`.js`) and CJS (`.cjs`) outputs
- TypeScript declarations (`.d.ts` for ESM, `.d.cts` for CJS)
- A conditional `exports` map in `package.json` resolving each entry

The public **API surface is unchanged**. All exports (functions, types,
components, hooks) are the same — only the resolution mechanism changed.

**What you need to do**

If you were using `transpilePackages: ['@itsocialist/voice']` in
`next.config.js` to force Next to compile our source, **remove that entry** —
it's no longer needed and can mask other issues:

```diff
  // next.config.js
  module.exports = {
-   transpilePackages: ['@itsocialist/voice'],
  };
```

If you weren't using `transpilePackages`, no action needed.

### 2. `peerDependencies` for React capped at `<20`

**What changed**

v0.2.x declared `"react": ">=18.0.0"`, which would silently accept a future
React 20+ install — but we have not tested against it and the SDK assumes
React 18/19 hook semantics.

v0.3.0 changes to `"react": ">=18 <20"` and same for `react-dom`. npm/pnpm
will now refuse to install `@itsocialist/voice` against React 20+ until we
explicitly bump the cap.

**What you need to do**

If you're on React 18 or 19, no change needed. If you're on React 20+ (when
it ships), you'll see a peer-dep warning until we cap up — file an issue if
that blocks you.

### 3. `tsconfig` paths alias renamed: `@briandawson/voice` → `@itsocialist/voice`

**What changed**

A handful of internal files still referenced the previous scope name
(`@briandawson/voice`) in `tsconfig.json` paths aliases and in comment
strings. These are now updated to `@itsocialist/voice`.

If you forked voice-lib and adapted the `tsconfig.json` paths, update your
fork's aliases to match.

---

## v0.2.x and earlier

No formally documented breaking changes — v0.2.x was a minor-version stream
inside the 0.x prerelease window. See [CHANGELOG.md](./CHANGELOG.md) for the
full release-by-release history.
