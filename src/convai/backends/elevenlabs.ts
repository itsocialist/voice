/**
 * ElevenLabs ConvAI backend implementation.
 *
 * Wraps the existing v0.2.x `createConvAIAgent` / `resolveUniversalAgent` /
 * `getSignedUrlWithOverrides` / `deleteConvAIAgent` / `getSignedUrl`
 * functions in the v0.3.3 `ConvAIBackend` interface. Existing functions
 * remain exported and continue to work — this is purely additive.
 */

import {
  createConvAIAgent,
  deleteConvAIAgent,
  getSignedUrl,
  getSignedUrlWithOverrides,
  ConvAIError,
} from '../client';
import type {
  ConvAIBackend,
  ConvAISessionHandle,
  ConvAISessionStartOpts,
} from '../backend';

export interface ElevenLabsBackendOptions {
  /**
   * ElevenLabs API key. When omitted, reads `process.env.ELEVENLABS_API_KEY`
   * lazily per call (so swapping the env var between calls works).
   */
  apiKey?: string;
}

/**
 * Construct an ElevenLabs ConvAI backend.
 *
 *   import { createConvAI } from '@itsocialist/voice';
 *   import { elevenlabs } from '@itsocialist/voice/convai/backends/elevenlabs';
 *
 *   const convai = createConvAI({ backend: elevenlabs({ apiKey }) });
 *   const handle = await convai.startSession({
 *     config: {
 *       agent: { systemPrompt, firstMessage, voiceId, agentName },
 *       llm: { model: 'gpt-4o-mini' },
 *     },
 *   });
 *
 * In v0.3.3 this is the only backend implementation. Hume EVI 3 / Cartesia
 * Line / OpenAI Realtime backends will appear here in v0.4+ as siblings.
 */
export function elevenlabs(options: ElevenLabsBackendOptions = {}): ConvAIBackend {
  const apiKey = options.apiKey;

  return {
    id: 'elevenlabs',

    async startSession(opts: ConvAISessionStartOpts): Promise<ConvAISessionHandle> {
      // Mode 1: ephemeral agent (full config supplied)
      if (opts.config && !opts.agentId) {
        const result = await createConvAIAgent(opts.config, apiKey);
        return {
          backend: 'elevenlabs',
          agentId: result.agentId,
          signedUrl: result.signedUrl,
          conversationToken: result.conversationToken,
          _ctx: { ephemeral: true },
        };
      }

      // Mode 2: existing agent + per-session overrides
      if (opts.agentId && opts.overrides) {
        const result = await getSignedUrlWithOverrides(opts.agentId, opts.overrides, apiKey);
        return {
          backend: 'elevenlabs',
          agentId: result.agentId,
          signedUrl: result.signedUrl,
          _ctx: { ephemeral: false },
        };
      }

      // Mode 3: existing agent, no overrides — just fetch a signed URL.
      if (opts.agentId && !opts.overrides) {
        const url = await getSignedUrl(opts.agentId, apiKey);
        return {
          backend: 'elevenlabs',
          agentId: opts.agentId,
          signedUrl: url,
          _ctx: { ephemeral: false },
        };
      }

      throw new ConvAIError({
        code: 'CONFIG_INVALID',
        type: 'config_invalid',
        message: 'startSession requires either { config } for ephemeral agents OR { agentId } for existing agents.',
        retryable: false,
      });
    },

    // ElevenLabs doesn't support a strict "resume" — signed URLs and tokens
    // are independent credentials. Caller can call startSession again with
    // the same agentId to refresh. We expose this as a "re-fetch credentials
    // for the same agent" operation.
    async resumeSession(handle: ConvAISessionHandle): Promise<ConvAISessionHandle> {
      const url = await getSignedUrl(handle.agentId, apiKey);
      return {
        ...handle,
        signedUrl: url,
        conversationToken: undefined,
      };
    },

    async endSession(handle: ConvAISessionHandle): Promise<void> {
      // Only delete the agent when it was ephemeral (created by us in
      // startSession with full config). Universal agents are caller-managed —
      // we never delete them on their behalf.
      const ctx = handle._ctx as { ephemeral?: boolean } | undefined;
      if (ctx?.ephemeral) {
        await deleteConvAIAgent(handle.agentId, { apiKey });
      }
    },
  };
}
