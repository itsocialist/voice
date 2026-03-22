# Consuming @briandawson/voice

## Installation

Until published to npm, add as a local workspace dependency:

```json
// sales-sim-trainer/app/package.json or power-speaker/app/package.json
{
  "dependencies": {
    "@briandawson/voice": "file:../../voice-lib"
  }
}
```

---

## 1. Register your voice profiles at app startup

Create `src/lib/voice-profiles.ts` in your app:

```ts
// sales-sim-trainer: src/lib/voice-profiles.ts
import { voiceRegistry } from '@briandawson/voice'

voiceRegistry.registerAll({
  'champion': {
    name: 'Champion / Internal Advocate',
    elevenlabsVoiceId: 'EXAVITQu4vr4xnSDxMaL',
    fishModelId: '7f92f8afb8ec43bf81429cc1c9199cb1',
    openaiVoice: 'nova',
    gender: 'female',
    ageRange: 'middle',
    elevenlabsSettings: { stability: 0.45, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true },
    fishSettings: { temperature: 0.7, top_p: 0.8, speed: 1.0 },
  },
  // ... other stakeholder profiles
})
```

```ts
// power-speaker: src/lib/voice-profiles.ts
import { voiceRegistry } from '@briandawson/voice'

voiceRegistry.registerAll({
  'coach': { ... },
  'narrator': { ... },
})
```

---

## 2. Drop in the API routes

```ts
// app/api/tts/route.ts
export { POST, GET } from '@briandawson/voice/next/tts-handler'
```

```ts
// app/api/stt/route.ts
export { POST, GET } from '@briandawson/voice/next/stt-handler'
```

```ts
// app/api/convai/agent/route.ts
export { POST, DELETE } from '@briandawson/voice/next/convai-handler'
```

That's it for the server side. **Delete your old route files.**

---

## 3. Update components

### AudioPlayer — old vs new

```tsx
// OLD (sales-sim-trainer)
<AudioPlayer text={text} subjectName={name} subjectAge={age} subjectCondition={condition} />

// NEW
<AudioPlayer text={text} profileKey={condition} />
// or with explicit provider:
<AudioPlayer text={text} profileKey="champion" provider="elevenlabs" />
```

### VoiceInput — unchanged API

```tsx
// No changes needed — same props
<VoiceInput onTranscript={setInput} autoSend onAutoSend={handleSubmit} />
```

### useConversation hook (power-speaker / full-duplex mode)

```tsx
// OLD (power-speaker) — ElevenLabsConversation.tsx
const { status, start, stop, isSpeaking } = usePowerSpeakerConversation({ scenario, config })

// NEW
import { useConversation } from '@briandawson/voice/react'

const conv = useConversation({
  buildConfig: () => ({
    systemPrompt: buildSystemPrompt(scenario),
    firstMessage: getFirstMessage(scenario),
    voiceId: resolveVoiceProfile('coach').elevenlabsVoiceId,
    agentName: 'Speaking Coach',
  }),
  onMessage: (role, text) => addMessage(role, text),
})

<button onClick={conv.start}>Start Session</button>
<button onClick={conv.stop}>End Session</button>
<div>Status: {conv.status}</div>
```

---

## 4. Environment variables

No changes — same env vars as before:

```bash
ELEVENLABS_API_KEY=sk_...
FISH_AUDIO_API_KEY=...
OPENAI_API_KEY=sk-...       # optional fallback
DEEPGRAM_API_KEY=...        # optional, for server-side STT
TTS_PROVIDER=elevenlabs     # default provider (elevenlabs | fish | openai)
STT_PROVIDER=deepgram       # default STT (deepgram | webspeech)
```

---

## 5. Per-request provider override (power-speaker feature)

```tsx
// Switch provider per-request without changing env vars
await speak(text, { provider: 'fish' })   // use Fish Audio for this one request
await speak(text, { provider: 'browser' }) // use browser Web Speech API
```

The old `process.env.TTS_PROVIDER = provider` mutation in power-speaker's TTS route
has been **removed** — it was unsafe under concurrent requests. Use `provider` in
the request body instead (already supported in the new route handler).
