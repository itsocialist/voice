# RFC — v0.4.3: Provider-aware `useConversation`

**Date:** 2026-05-13
**Author:** voice-lib team
**Status:** Draft — written before implementation; this doc is the spec we build to.

---

## Goal

Make `useConversation` / `useVoiceDuplex` work against both ElevenLabs ConvAI
and Hume EVI 3 from React, without forcing consumers to import a different
hook or change their call sites. Honors the v0.3.3 design-review decision
that the React layer mirrors the server-side `createConvAI({ backend })`
abstraction: provider switched by what the agent route returns, not by what
import the consumer chose.

Specifically:

- **Same hook works against both backends.** `useConversation({ buildConfig })`
  doesn't change shape. The agent route's response shape determines dispatch.
- **`UseConversationResult` interface is unchanged from v0.4.2.** Every field
  (`status`, `isSpeaking`, `agentVolume`, `micPermission`, `lastInterruptionAt`,
  `error`, `start`, `stop`, `changeInputDevice`, `changeOutputDevice`,
  `getInputByteFrequencyData`, `getOutputByteFrequencyData`) keeps the same
  signature. SpeakerHero's existing code keeps working byte-for-byte.
- **`hume` peer dep is optional.** Consumers using only ElevenLabs don't pay
  for the Hume SDK in their bundle.

## Non-goals

- A general-purpose ConvAI protocol abstraction. Each backend is a different
  WebSocket protocol. We don't try to unify them at the wire level.
- Adopting a different ElevenLabs SDK. `@elevenlabs/client` (already
  installed) is what we use.
- Migrating SpeakerHero. The whole point is they don't have to.

---

## The core constraint that drove the design

React's rules-of-hooks ban conditional sub-hook calls. So we **can't** write:

```ts
function useConversation(options) {
  const handle = await getHandle(); // can't await in a hook
  if (handle.backend === 'hume') {
    return useHumeSDKHook(...);     // <-- forbidden, conditional hook call
  }
  return useElevenLabsHook(...);
}
```

The pre-v0.4.3 implementation gets around this by calling
`useElevenLabsConversation` unconditionally at the top of our hook (line 150
of `react/hooks/useConversation.ts`). That works for one backend; it breaks
for two because we'd have to call both backends' hooks every render even when
only one is active. And it would force the `hume` SDK to be a hard dep — not
optional.

**Therefore: drop the React-sub-hook approach entirely. Use both backends'
imperative APIs directly inside `useEffect` / `useCallback`.**

This is unblocked by the existing dep tree — `@elevenlabs/client` already
ships a non-React imperative API (`Conversation.startSession()`,
`VoiceConversation` class). Hume's official SDK has a similar shape per
preliminary research.

---

## Current state (v0.4.2)

`react/hooks/useConversation.ts` (315 lines) does, in this order:

1. Reads options (`buildConfig`, `agentRoute`, `onMessage`, `onStatusChange`,
   `onError`, `onInterruption`, `inputDeviceId`, `outputDeviceId`).
2. Sets up React state: `status`, `error`, `micPermission`, `lastInterruptionAt`,
   plus refs (`agentIdRef`, `transportRef`, `pendingInputDeviceIdRef`).
3. Mic permission monitoring via `useEffect` and Permissions API.
4. Wraps user callbacks in refs (`onStatusChangeRef`, `onMessageRef`,
   `onErrorRef`, `onInterruptionRef`) so the SDK hook below doesn't churn.
5. **Calls `useElevenLabsConversation({...})` unconditionally** (line 150).
   This is the hook coupling we're removing.
6. Stashes the SDK return in `elevenRef`.
7. `start()` callback: POST agent route → read `signed_url` /
   `conversation_token` from response → call
   `elevenRef.current.startSession({ signedUrl })`.
8. `stop()`, `changeInputDevice`, `changeOutputDevice` — all delegate to
   `elevenRef.current`.
9. Returns `UseConversationResult`.

`react/hooks/useVoiceDuplex.ts` is a 51-line thin wrapper over `useConversation`.
`VoiceDuplexProvider` wraps children in `@elevenlabs/react`'s
`ConversationProvider` — needed for the React-context state that the
**sub-hook** depends on. **Once we drop the sub-hook, the provider becomes a
no-op passthrough.**

---

## Design

### High-level shape

```ts
function useConversation(options: UseConversationOptions): UseConversationResult {
  const [status, setStatus] = useState<ConversationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<MicPermissionState>('unknown');
  const [lastInterruptionAt, setLastInterruptionAt] = useState<number | null>(null);

  // Imperative session handle — typed as the union of backend-specific
  // controller interfaces.
  const sessionRef = useRef<ConversationSession | null>(null);

  // ... callback refs, mic permission useEffect, all unchanged ...

  const start = useCallback(async () => {
    setError(null);
    setLastInterruptionAt(null);
    updateStatus('connecting');

    try {
      const config = await buildConfig();
      const res = await fetch(agentRoute, { /* ... */ });
      const data = await res.json() as ConvAIRouteResponse;

      // ── Dispatch on response shape ───────────────────────────────
      const backend = pickBackend(data);

      // mic permission check (same as today, runs before SDK touches mic)
      const permStream = await navigator.mediaDevices.getUserMedia({ audio: ... });
      permStream.getTracks().forEach(t => t.stop());

      const session = await openSession(backend, data, {
        onStatusChange: (next) => updateStatus(next),
        onMessage: (role, text) => onMessageRef.current?.(role, text),
        onInterruption: (event) => { setLastInterruptionAt(Date.now()); onInterruptionRef.current?.(event); },
        onError: (msg) => { setError(msg); updateStatus('error'); onErrorRef.current?.(msg); },
        inputDeviceId, outputDeviceId,
      });

      sessionRef.current = session;
    } catch (err) {
      // ... existing error path ...
    }
  }, [agentRoute, buildConfig, inputDeviceId, outputDeviceId]);

  // stop, changeInputDevice, changeOutputDevice → sessionRef.current.<method>()

  return {
    status, isSpeaking: status === 'agent-speaking', error, micPermission,
    lastInterruptionAt,
    agentVolume: sessionRef.current?.getOutputVolume() ?? 0,
    start, stop, changeInputDevice, changeOutputDevice,
    getInputByteFrequencyData: () => sessionRef.current?.getInputByteFrequencyData() ?? new Uint8Array(0),
    getOutputByteFrequencyData: () => sessionRef.current?.getOutputByteFrequencyData() ?? new Uint8Array(0),
  };
}
```

### The `ConversationSession` interface

Define a thin **adapter** interface that both backends conform to. The hook
only talks to this interface. Each backend (ElevenLabs, Hume) gets its own
file under `react/sessions/`.

```ts
// react/sessions/types.ts
export interface ConversationSession {
  end(): Promise<void>;
  changeInputDevice(deviceId: string): Promise<void>;
  changeOutputDevice(deviceId: string): Promise<void>;
  getInputByteFrequencyData(): Uint8Array;
  getOutputByteFrequencyData(): Uint8Array;
  getOutputVolume(): number;
}

export interface OpenSessionCallbacks {
  onStatusChange(next: ConversationStatus): void;
  onMessage(role: 'agent' | 'user', text: string): void;
  onInterruption(event: { eventId: number }): void;
  onError(message: string): void;
}

export interface OpenSessionOptions extends OpenSessionCallbacks {
  inputDeviceId?: string;
  outputDeviceId?: string;
}
```

### The dispatch function

```ts
// react/sessions/dispatch.ts
async function openSession(
  backend: ConvAIProviderId,
  routeData: ConvAIRouteResponse,
  opts: OpenSessionOptions,
): Promise<ConversationSession> {
  switch (backend) {
    case 'elevenlabs': {
      const { openElevenLabsSession } = await import('./elevenlabs-session');
      return openElevenLabsSession(routeData, opts);
    }
    case 'hume': {
      // Lazy import — keeps hume out of the bundle for ElevenLabs-only consumers.
      const { openHumeSession } = await import('./hume-session');
      return openHumeSession(routeData, opts);
    }
    default:
      throw new ConvAIError({
        code: 'BACKEND_UNSUPPORTED',
        type: 'config_invalid',
        message: `No React session adapter for backend '${backend}'.`,
        retryable: false,
      });
  }
}
```

Lazy `import()` is the lever for the optional Hume peer dep — Webpack /
esbuild / Rollup all support code-splitting on dynamic import, so consumers
who never go down the `case 'hume'` path don't pull the SDK.

### Picking the backend from the response

The agent route response today has shape
`{ agent_id, conversation_token?, signed_url? }`. v0.4.3 adds an optional
`backend` field (defaults to `'elevenlabs'` for back-compat):

```ts
// what the route returns now (v0.4.3+):
{
  backend?: 'elevenlabs' | 'hume',  // optional, defaults to 'elevenlabs'
  agent_id: string,
  signed_url?: string,                // ElevenLabs WebSocket OR Hume wss URL
  conversation_token?: string,        // ElevenLabs WebRTC only
}
```

Dispatch reads `data.backend ?? 'elevenlabs'`. Routes that haven't been
updated keep returning the ElevenLabs shape and dispatch correctly.

For the Next.js `convai-handler`, we extend it to set `backend` based on
which `ConvAIBackend` was used to create the agent (today: always
`'elevenlabs'`; once consumers wire the Hume backend through the handler,
it'll vary).

### The `VoiceDuplexProvider` question

The provider exists today to satisfy `@elevenlabs/react`'s
`ConversationProvider` context requirement. Once we drop the sub-hook usage,
the provider has nothing to wrap.

**Decision: keep `VoiceDuplexProvider` as an exported component that just
renders `<>{children}</>`.** Consumer code that wraps with it keeps working;
no migration churn for SpeakerHero. Drop the `@elevenlabs/react`
`ConversationProvider` from the render tree.

Add a JSDoc note: "No longer required as of v0.4.3, retained for back-compat.
Safe to remove from your tree."

### ElevenLabs session adapter

```ts
// react/sessions/elevenlabs-session.ts
import { Conversation, type VoiceConversation } from '@elevenlabs/client';

export async function openElevenLabsSession(
  data: ConvAIRouteResponse,
  opts: OpenSessionOptions,
): Promise<ConversationSession> {
  const sessionConfig = data.signed_url
    ? { signedUrl: data.signed_url }
    : data.conversation_token
    ? { conversationToken: data.conversation_token }
    : null;

  if (!sessionConfig) {
    throw new ConvAIError({
      code: 'NO_CREDENTIALS',
      type: 'upstream_invalid',
      message: 'Agent route returned neither signed_url nor conversation_token.',
      retryable: false,
    });
  }

  const conversation = await Conversation.startSession({
    ...sessionConfig,
    ...(opts.inputDeviceId && { inputDeviceId: opts.inputDeviceId }),
    ...(opts.outputDeviceId && { outputDeviceId: opts.outputDeviceId }),
    onConnect: ({ conversationId }) => opts.onStatusChange('connected'),
    onDisconnect: () => opts.onStatusChange('idle'),
    onMessage: ({ message, source, role }) => {
      const r = role ?? (source === 'ai' ? 'agent' : 'user');
      opts.onMessage(r, message);
    },
    onModeChange: ({ mode }) =>
      opts.onStatusChange(mode === 'speaking' ? 'agent-speaking' : 'user-speaking'),
    onError: (msg) => opts.onError(typeof msg === 'string' ? msg : 'Conversation error'),
    onInterruption: (event) => opts.onInterruption({ eventId: event.event_id }),
  }) as VoiceConversation;

  // WebRTC initial-mic-track audio-constraints fix from v0.2.1: re-apply
  // changeInputDevice after connect when on the WebRTC path with an explicit
  // inputDeviceId. Logic moves here from the hook.
  if (data.conversation_token && opts.inputDeviceId) {
    await conversation.changeInputDevice({ inputDeviceId: opts.inputDeviceId })
      .catch((err) => console.warn('[voice-lib] post-connect changeInputDevice failed:', err));
  }

  return {
    end: () => conversation.endSession(),
    changeInputDevice: (deviceId) => conversation.changeInputDevice({ inputDeviceId: deviceId }),
    changeOutputDevice: (deviceId) => conversation.changeOutputDevice({ outputDeviceId: deviceId }),
    getInputByteFrequencyData: () => conversation.getInputByteFrequencyData(),
    getOutputByteFrequencyData: () => conversation.getOutputByteFrequencyData(),
    getOutputVolume: () => conversation.getOutputVolume(),
  };
}
```

### Hume session adapter

```ts
// react/sessions/hume-session.ts
// Requires 'hume' peer dep installed by the consumer (peerDependenciesMeta).
import type { OpenSessionOptions, ConversationSession } from './types';

export async function openHumeSession(
  data: ConvAIRouteResponse,
  opts: OpenSessionOptions,
): Promise<ConversationSession> {
  // Lazy import — never hit by ElevenLabs-only consumers.
  const { HumeClient } = await import('hume')
    .catch(() => { throw new ConvAIError({
      code: 'HUME_SDK_NOT_INSTALLED',
      type: 'config_invalid',
      provider: 'hume',
      message: 'The Hume React adapter requires the optional `hume` peer dependency. Run `npm install hume`.',
      retryable: false,
    }); });

  if (!data.signed_url) {
    throw new ConvAIError({
      code: 'HUME_NO_WSS_URL',
      type: 'upstream_invalid',
      provider: 'hume',
      message: 'Hume agent route must return signed_url (the wss://api.hume.ai URL).',
      retryable: false,
    });
  }

  // Approach A: pass the wss URL directly to a raw WebSocket. Cleanest;
  // doesn't touch HumeClient's request builder. We have to handle audio
  // framing + event parsing ourselves.
  //
  // Approach B: parse config_id and access_token out of the URL, instantiate
  // HumeClient, call client.empathicVoice.chat.connect({...}). Cleaner for
  // protocol correctness; messier URL parsing.
  //
  // PICKED: Approach B for protocol safety, with the URL-parsing isolated to
  // this file. Hume's WS protocol has subtle pieces (chat_metadata, audio
  // framing) we'd rather not get wrong by hand.

  const url = new URL(data.signed_url);
  const configId = url.searchParams.get('config_id') ?? data.agent_id;
  const accessToken = url.searchParams.get('access_token');
  // ... feed to HumeClient.empathicVoice.chat.connect ...
  // ... wire callbacks: socket.on('message') → opts.onMessage(...), etc.

  // RETURN the ConversationSession shape — exact mapping TBD during
  // implementation. Key pieces:
  // - end() → socket.close()
  // - changeInputDevice / changeOutputDevice — TBD; Hume may not expose
  //   mid-session device switch through the SDK; could be unsupported (throw
  //   a clear "not supported on Hume" error) for v0.4.3
  // - getInput/OutputByteFrequencyData — needs us to maintain our own
  //   AnalyserNode chain on the mic + agent audio streams. Real work.
  // - onInterruption → Hume's server messages include barge-in events;
  //   parse and call opts.onInterruption.
}
```

**Honesty flag for v0.4.3 scope:** the Hume adapter's frequency data
(`getInputByteFrequencyData` / `getOutputByteFrequencyData`) and
`changeInputDevice` / `changeOutputDevice` are the riskiest pieces. v0.4.2's
new `<VoiceWaveform>` / `useInputBands` rely on the frequency data being
populated. If Hume's SDK doesn't expose it directly, we have to wire our own
Web Audio API analyser chain to whatever MediaStream the SDK manages. That's
real engineering. **If it slips, v0.4.3 ships with Hume frequency data
returning empty buffers and `<VoiceWaveform>` showing flat bars for Hume
sessions.** Document the limitation; close in v0.4.3.1.

---

## Backward compat / SpeakerHero risk surface

The whole point of this RFC is "SpeakerHero doesn't have to migrate." Real
risks worth enumerating:

| Risk | Severity | Mitigation |
|---|---|---|
| `Conversation.startSession()` from `@elevenlabs/client` behaves differently than the React hook's `startSession` | **High** — would silently break SpeakerHero's working flow | Test the ElevenLabs path end-to-end against a live agent before tagging v0.4.3. Compare event order, error shape, mic permission timing, status transitions to v0.4.2 behavior. |
| `VoiceDuplexProvider` retained but no longer functional | Low | JSDoc note + CHANGELOG. Component still mounts and renders children; just doesn't add context. |
| `agentVolume` value semantics shift | Medium | Today: 0/1 from `getOutputVolume()`. After: same passthrough to imperative API. Should be identical. Verify in testing. |
| WebRTC initial-mic-track audio-constraints fix (v0.2.1 COE-S11-001) | High — the hard-won macOS fix | Logic moves from the hook into `elevenlabs-session.ts` unchanged. Same behavior. |
| `onMessage` role-vs-source handling | Low | Same logic in adapter. |
| Mic permission stream is acquired twice (consumer's check + SDK's internal) | Low — was an issue in v0.2.0, fixed by stopping the perm stream before `startSession`. Keep same pattern. |
| `lastInterruptionAt` set by `onInterruption` | Low | Just move into the adapter's `onInterruption` wiring. |

**Pre-tag verification gate** (must pass before publishing v0.4.3):

1. Pack tarball; install in `/tmp/v043-elevenlabs-smoke/`.
2. Verify ElevenLabs path: `useConversation` exports same shape, calling
   `conv.start()` against a live agent connects, `onMessage` fires, `onInterruption`
   fires when interrupted, `conv.stop()` cleans up.
3. Verify `<VoiceWaveform>` still animates against ElevenLabs frequency data.

We can't verify Hume end-to-end without live credentials. Smoke-test type
shape + lazy-import behavior is the bar for the Hume side in v0.4.3 itself.

---

## Open questions

1. **Does `Conversation.startSession()` work from the browser, or is it
   Node-only?** Per `@elevenlabs/client`'s `VoiceConversation.js` source (we
   read earlier), it uses `navigator.mediaDevices.getUserMedia`, AudioContext,
   etc — clearly browser-targeted. Confirm by importing in a Vite-built
   sandbox before relying on it.

2. **Does the lazy `import('hume')` pattern survive Next.js App Router's
   server/client split?** App Router's "use client" boundary affects what
   imports are allowed where. The dispatch function lives in a `'use client'`
   file (it's called from a hook), so the dynamic import should be fine. But
   need to verify it doesn't trip RSC bundling on first render.

3. **Hume `getInputByteFrequencyData` plumbing.** Hume's `hume` SDK exposes
   the WebSocket events but does it expose the AnalyserNode on the audio
   pipeline? If not, our adapter needs to wire its own AnalyserNode against
   the MediaStream Hume produces. This is the biggest unknown.

4. **Should `changeInputDevice` on Hume throw "not supported" or no-op?**
   Lean toward throwing — explicit "this backend doesn't support that yet"
   is better than silent no-op.

5. **`ConvAIRouteResponse.backend` default.** When the field is missing
   (older routes that haven't been updated), default to `'elevenlabs'`. This
   keeps SpeakerHero's existing route working without any change on their
   side.

---

## Implementation plan

Tight sequence; each step is a separate commit that should build clean and
pass the existing tests.

1. **Add `react/sessions/types.ts`** with `ConversationSession`,
   `OpenSessionOptions`, `OpenSessionCallbacks`. No behavior change yet.

2. **Add `react/sessions/elevenlabs-session.ts`** porting the existing
   ElevenLabs logic from `useConversation.ts`. Don't wire it into the hook
   yet — write it standalone and verify it compiles + types are right.

3. **Refactor `useConversation.ts`** to drop `useElevenLabsConversation` and
   use `openElevenLabsSession()` instead. Hard-code dispatch to ElevenLabs
   for this commit. Test against existing test suite + /tmp consumer smoke.

4. **Strip `ConversationProvider` from `VoiceDuplexProvider.tsx`.** It
   becomes a pass-through `<>{children}</>`. JSDoc note.

5. **Add `react/sessions/dispatch.ts`** with `openSession(backend, ...)`
   that switches on backend and lazy-imports the adapter. ElevenLabs path
   still works because of step 3; dispatch just adds the conditional.

6. **Add `react/sessions/hume-session.ts`** with the Hume adapter. Lazy
   import the `hume` SDK with a clear "install hume" error if missing.

7. **Update `next/convai-handler.ts`** to include `backend` field in the
   POST response. Default `'elevenlabs'` for the existing flow.

8. **Add `hume` to `peerDependencies` + `peerDependenciesMeta.optional = true`**
   in `package.json`. Bump version 0.4.2 → 0.4.3.

9. **Pre-tag verification gate** (manual): run the ElevenLabs smoke path,
   verify `<VoiceWaveform>` works against a live ElevenLabs session, confirm
   no regression vs. v0.4.2.

10. **CHANGELOG + ship.**

Hume `session_settings` overrides + OAuth token auto-refresh are server-side
work — not in this refactor. Could either bundle as v0.4.3 (the public
route surface change is small) or ship as v0.4.3.1.
**Decision: bundle, since both touch the Hume backend's existing implementation.**

---

## Test checklist (for the verification gate)

- [ ] `npm run typecheck` clean
- [ ] `npm run test:run` 27/27 passing
- [ ] CI smoke: ESM + CJS + deep-imports still pass
- [ ] `/tmp` consumer can import every previously-exported name
- [ ] `useConversation` against a live ElevenLabs agent connects, messages
      flow, interruption fires, stop cleans up
- [ ] `<VoiceWaveform>` animates against the live ElevenLabs session
- [ ] WebRTC initial-mic-track audio quality (COE-S11-001 regression check)
- [ ] Hume adapter: `import('hume')` throws clearly with install hint when
      not installed
- [ ] Hume adapter: type-shape verification with `hume` installed (full
      live test deferred — needs live Hume creds)

---

## Out of scope for v0.4.3

- Hume frequency-data plumbing if it needs a full Web Audio API analyser
  chain (could slip to v0.4.3.1 with a documented "Hume waveform shows
  flat bars" limitation)
- Unifying ElevenLabs WebSocket vs WebRTC paths under a richer abstraction
  (the dispatch already handles both via `signed_url` vs `conversation_token`)
- Adding Cartesia Line / OpenAI Realtime adapters — those are v0.5.0
- Test coverage rebuild (v0.4.4)

# ═══════════════════════════════════════════════════════════════════
# EOF
# ═══════════════════════════════════════════════════════════════════
