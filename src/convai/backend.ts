/**
 * ConvAI backend abstraction (v0.3.3+).
 *
 * Provider-neutral interface for full-duplex voice-agent sessions. Steals the
 * pattern from Vercel AI SDK's language-model providers: instantiate a
 * backend object (`elevenlabs({apiKey})`), pass it to `createConvAI({backend})`,
 * call provider-neutral verbs (`startSession`, `endSession`).
 *
 * v0.3.3 ships only the ElevenLabs implementation behind this skeleton.
 * Hume EVI 3, Cartesia Line, OpenAI Realtime targeted for v0.4–v0.5.
 *
 * Existing v0.2.x functions (`createConvAIAgent`, `resolveUniversalAgent`,
 * `getSignedUrlWithOverrides`, `deleteConvAIAgent`, `getSignedUrl`) remain
 * exported and unchanged — they're now implemented as ElevenLabs-specific
 * helpers. The new abstraction is additive; consumers can adopt at their
 * own pace.
 */

import type { ConvAIAgentConfig, ConvAISessionOverrides } from '../types';
import type { ConvAIProviderId } from './client';

/**
 * Opaque handle representing a live ConvAI session. The shape's internals
 * are intentionally provider-specific — consumers should not destructure
 * fields out of this. Instead, treat it as a token: pass to `endSession`
 * for cleanup, read `signedUrl`/`conversationToken` only for the SDK
 * `startSession` call.
 *
 * Future backends may carry richer state (Hume session-resume tokens,
 * OpenAI Realtime ephemeral keys, etc.) inside `_ctx`.
 */
export interface ConvAISessionHandle {
  /** Which backend produced this handle. */
  readonly backend: ConvAIProviderId;
  /** Agent identifier — opaque to consumers. */
  readonly agentId: string;
  /** Signed WebSocket URL (when transport is WebSocket). */
  readonly signedUrl?: string;
  /** WebRTC conversation token (when transport is WebRTC). */
  readonly conversationToken?: string;
  /**
   * Backend-private context for resume / refresh / cleanup. Intentionally
   * untyped on the public surface.
   */
  readonly _ctx?: unknown;
}

/**
 * Options for `ConvAIBackend.startSession`. Two valid modes:
 *
 *   1. Ephemeral agent — `{ config }`: backend creates a per-session agent,
 *      returns credentials, owns its cleanup.
 *   2. Existing agent — `{ agentId, overrides? }`: backend fetches session
 *      credentials for a long-lived "universal" agent that the consumer
 *      created and cached earlier.
 */
export interface ConvAISessionStartOpts {
  /** Full config for an ephemeral per-session agent. */
  config?: ConvAIAgentConfig;
  /** Existing long-lived agent ID (from `resolveUniversalAgent`). */
  agentId?: string;
  /** Per-session overrides applied on top of the existing agent's base config. */
  overrides?: ConvAISessionOverrides;
}

/**
 * ConvAI provider implementation. Each backend (ElevenLabs, future:
 * Hume, Cartesia Line, OpenAI Realtime) exposes this interface.
 */
export interface ConvAIBackend {
  /** Stable identifier for this backend. */
  readonly id: ConvAIProviderId;

  /**
   * Start a session — ephemeral or against an existing agent.
   * See `ConvAISessionStartOpts` for the two modes.
   */
  startSession(opts: ConvAISessionStartOpts): Promise<ConvAISessionHandle>;

  /**
   * Refresh session credentials for an existing handle. Used when signed
   * URLs / tokens expire mid-session and the consumer needs new ones to
   * resume. Not all backends support resume — returns the same handle
   * unchanged when unsupported.
   */
  resumeSession?(handle: ConvAISessionHandle): Promise<ConvAISessionHandle>;

  /**
   * Cleanup. For ephemeral agents this deletes the agent. For long-lived
   * "universal" agent sessions (consumer-managed lifecycle), this is a no-op.
   * Always best-effort; never throws.
   */
  endSession(handle: ConvAISessionHandle): Promise<void>;
}

/**
 * Aggregate API returned by `createConvAI({ backend })`. Provides
 * provider-neutral verbs over whichever backend was supplied.
 */
export interface ConvAIClient {
  readonly backend: ConvAIProviderId;
  startSession(opts: ConvAISessionStartOpts): Promise<ConvAISessionHandle>;
  resumeSession(handle: ConvAISessionHandle): Promise<ConvAISessionHandle>;
  endSession(handle: ConvAISessionHandle): Promise<void>;
}

/**
 * Construct a ConvAIClient bound to a specific backend instance.
 *
 *   const convai = createConvAI({ backend: elevenlabs({ apiKey: KEY }) });
 *   const handle = await convai.startSession({ config: { agent: {...}, ... } });
 *   // ... use handle.signedUrl with @elevenlabs/react's startSession ...
 *   await convai.endSession(handle);
 *
 * The returned client doesn't keep any state — it's a thin dispatcher to
 * the backend's methods. Safe to instantiate per-request or hold as a
 * module-scope singleton.
 */
export function createConvAI(opts: { backend: ConvAIBackend }): ConvAIClient {
  const { backend } = opts;
  return {
    backend: backend.id,
    startSession: (params) => backend.startSession(params),
    resumeSession: (handle) =>
      backend.resumeSession ? backend.resumeSession(handle) : Promise.resolve(handle),
    endSession: (handle) => backend.endSession(handle),
  };
}

// ── Public verbs (default-backend convenience) ────────────────────────────

let _defaultBackend: ConvAIBackend | null = null;

/**
 * Override the default ConvAI backend used by the standalone verbs
 * (`startConvAISession`, etc). Call once at server boot.
 *
 * If never called, the standalone verbs lazy-default to the ElevenLabs
 * backend using `process.env.ELEVENLABS_API_KEY`.
 */
export function setDefaultConvAIBackend(backend: ConvAIBackend): void {
  _defaultBackend = backend;
}

function getDefaultBackend(): ConvAIBackend {
  if (_defaultBackend) return _defaultBackend;
  // Lazy require to avoid circular import at module load. The elevenlabs
  // factory reads ELEVENLABS_API_KEY from process.env when no key is passed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { elevenlabs } = require('./backends/elevenlabs') as typeof import('./backends/elevenlabs');
  _defaultBackend = elevenlabs();
  return _defaultBackend;
}

/**
 * Standalone verb — `convai.startSession()` against the default backend.
 * Equivalent to `createConvAI({ backend: getDefaultConvAIBackend() }).startSession(opts)`.
 */
export function startConvAISession(opts: ConvAISessionStartOpts): Promise<ConvAISessionHandle> {
  return getDefaultBackend().startSession(opts);
}

/** Standalone `resumeSession()` — no-op for backends that don't support resume. */
export function resumeConvAISession(handle: ConvAISessionHandle): Promise<ConvAISessionHandle> {
  const backend = getDefaultBackend();
  return backend.resumeSession ? backend.resumeSession(handle) : Promise.resolve(handle);
}

/** Standalone `endSession()` — cleanup the agent backing this handle. */
export function endConvAISession(handle: ConvAISessionHandle): Promise<void> {
  return getDefaultBackend().endSession(handle);
}
