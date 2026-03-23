# Testing Guide — @itsocialist/voice

How to verify the library works, tips for developing voice capabilities in an app.

---

## Unit Tests

Unit tests use [Vitest](https://vitest.dev/) and mock all provider HTTP calls — no API keys needed.

```bash
npm test           # run once
npm test -- --watch  # watch mode
```

### What the tests cover

| File | Covers |
|------|--------|
| `src/__tests__/registry.test.ts` | VoiceRegistry: exact match, fuzzy/partial match, multi-key registration, fallback to default |
| `src/__tests__/tts-router.test.ts` | Provider resolution order, TTS_PROVIDER env var, automatic fallback when primary fails |
| `src/__tests__/next-handlers.test.ts` | POST/GET route handlers: missing text, browser TTS signal, profile resolution, error responses |

---

## Live Provider Check (Integration Script)

Calls real provider APIs, measures latency, and saves sample `.mp3` files to `./tmp/`.

```bash
# 1. Set API keys
export ELEVENLABS_API_KEY=your_key
export OPENAI_API_KEY=your_key          # optional
export FISH_AUDIO_API_KEY=your_key      # optional
export FISH_TEST_MODEL_ID=your_model    # Fish Audio reference model ID
export DEEPGRAM_API_KEY=your_key        # optional

# 2. Run the check
npx tsx scripts/check-providers.ts
```

Sample output:
```
── ElevenLabs TTS ──
  ✓  Synthesized 24312 bytes in 387ms
     Saved: ./tmp/sample-elevenlabs.mp3

── Fish Audio TTS ──
  ✓  Synthesized 19840 bytes in 512ms
     Saved: ./tmp/sample-fish.mp3

── Deepgram STT ──
  ✓  Transcribed in 214ms — confidence: 98%
     Transcript: "Voice library provider check. One two three."
```

If a key is missing the provider is skipped — you only need the providers you intend to use.

---

## Testing in a Next.js App

### Step 1 — Wire up routes

```ts
// app/api/tts/route.ts
export { POST, GET } from '@itsocialist/voice/next/tts-handler'

// app/api/stt/route.ts
export { POST, GET } from '@itsocialist/voice/next/stt-handler'

// app/api/convai/agent/route.ts
export { POST, DELETE } from '@itsocialist/voice/next/convai-handler'
```

### Step 2 — Verify provider status

```bash
curl http://localhost:3000/api/tts
# → {"primary":"elevenlabs","available":["elevenlabs","fish"],"fallbacks":["fish"]}
```

### Step 3 — Test TTS directly

```bash
curl -s -X POST http://localhost:3000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from curl","profileKey":"narrator"}' \
  --output /tmp/test.mp3 \
  -D -

# Response headers tell you what happened:
# X-TTS-Provider: elevenlabs
# X-TTS-Latency-Ms: 412
# X-Voice-Name: Narrator
```

### Step 4 — Test browser TTS signal

```bash
curl -X POST http://localhost:3000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello","provider":"browser"}'
# → {"useBrowserTTS":true,"text":"Hello"}
```

### Step 5 — Test STT

```bash
curl -X POST http://localhost:3000/api/stt \
  -H 'Content-Type: audio/webm' \
  --data-binary @/tmp/recording.webm
# → {"transcript":"...","confidence":0.97,"provider":"deepgram","latencyMs":230}
```

---

## Tips: Designing Voice Capabilities in Your App

### Decide on your provider strategy first

Before writing any component code, answer these questions:

1. **Which TTS providers will you use?** Start with ElevenLabs only if you have a key. Add Fish Audio as a fallback if cost matters at scale.
2. **Do you need STT?** Browser Web Speech is free and works offline. Deepgram is better for noisy environments and non-English.
3. **Do you need ConvAI?** Only if you need full-duplex, interruption-capable conversation (not just transcribe + respond).

Set `TTS_PROVIDER` in `.env.local` to lock in your preferred provider during development so you don't accidentally burn credits on fallback calls.

### Voice profile design workflow

1. **Start with one voice, one provider.** Get ElevenLabs working with a single profile before adding Fish Audio.
2. **Name profiles after roles, not voices.** Use `'narrator'`, `'coach'`, `'guide'` — not `'ElevenLabs Sarah'`. This keeps your app provider-agnostic.
3. **Tune settings iteratively.** Use the `AudioPlayer` component with `autoPlay` to A/B test settings in the browser.
4. **Match voice to context.** Lower `stability` (0.3–0.5) for emotional/reactive lines. Higher (0.7–0.9) for factual information.

```ts
// Low stability — expressive, reactive
const coachingVoice: VoiceProfile = {
  elevenlabsSettings: { stability: 0.35, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true },
  // ...
}

// High stability — clear, consistent
const narratorVoice: VoiceProfile = {
  elevenlabsSettings: { stability: 0.75, similarity_boost: 0.75, style: 0.1, use_speaker_boost: false },
  // ...
}
```

### Managing state with useVoice

`useVoice` returns `state: 'idle' | 'loading' | 'playing' | 'error'`. Use `state` to drive your UI:

```tsx
const { state, speak, stop } = useVoice({ ttsRoute: '/api/tts' })

// Disable input while audio is playing
<textarea disabled={state === 'playing'} />

// Queue next speech only after current finishes
const speakSequence = async (lines: string[]) => {
  for (const line of lines) {
    await speak(line, { profileKey: 'narrator' })
    // speak() resolves when audio finishes
  }
}
```

### Building a ConvAI prototype

The fastest way to prototype ConvAI is with a minimal `buildConfig`:

```tsx
const conv = useConversation({
  buildConfig: () => ({
    systemPrompt: 'You are a helpful assistant. Be concise.',
    firstMessage: 'Hi! What can I help you with?',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',  // ElevenLabs "Sarah"
    agentName: 'Assistant',
  }),
  onMessage: (role, text) => console.log(`[${role}]`, text),
  onStatusChange: (status) => console.log('Status:', status),
})
```

Start there. Once the conversation feels right, swap in your production `voiceId` and refine the system prompt.

### ConvAI status states — what to show the user

| Status | What to show |
|--------|-------------|
| `idle` | "Start conversation" button |
| `connecting` | Spinner / "Connecting…" |
| `connected` | "Connected" badge (brief) |
| `agent-speaking` | Animated waveform or "Agent speaking…" |
| `user-speaking` | Mic indicator, "Listening…" |
| `disconnecting` | "Ending…" |
| `error` | Error message + retry button |

### Testing ConvAI without burning tokens

1. Use `onMessage` to log all messages to a `<pre>` element — you can read the full conversation without listening.
2. Keep system prompts short during development to reduce token usage.
3. Test with the browser STT mode (`mode: 'browser'` in `useSTT`) before switching to Deepgram — browser STT is free.

### Debugging checklist

- **No audio?** Check the network tab — is `/api/tts` returning 200 with `Content-Type: audio/mpeg`?
- **ConvAI not connecting?** Check for `ELEVENLABS_API_KEY` in your server environment (not just `.env.local`).
- **Fish Audio returning errors?** Verify your `fishModelId` is a valid reference model ID from the Fish Audio console — it must be a cloned/public model, not a built-in.
- **Provider fallback happening unexpectedly?** Call `GET /api/tts` to see which providers are actually available at runtime.
- **useSTT not working?** Browser requires HTTPS or `localhost`. Mic permission is required. Check `micPermission` from `useSTT` — it surfaces `'denied'` / `'granted'` / `'prompt'`.
