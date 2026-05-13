'use client';

/**
 * React-side ConvAI backend dispatch (v0.4.3+).
 *
 * Reads `data.backend` from the agent route response and instantiates the
 * matching `ConversationSession` adapter. ElevenLabs is the default when
 * `backend` is missing (back-compat for routes that haven't been updated).
 *
 * Lazy imports per backend: webpack / esbuild / Rollup code-split on
 * `import()`, so consumers who never go through the `hume` path don't pull
 * the `hume` SDK into their bundle. This is what makes `hume` viable as an
 * optional peer dep.
 *
 * See development/rfc-v0.4.3-provider-aware-useConversation.md.
 */

import { ConvAIError } from '../../src/convai/client';
import { openElevenLabsSession } from './elevenlabs-session';
import type {
  ConversationSession,
  ConvAIRouteResponse,
  OpenSessionOptions,
} from './types';

export async function openSession(
  data: ConvAIRouteResponse,
  opts: OpenSessionOptions,
): Promise<ConversationSession> {
  // Default to 'elevenlabs' for back-compat with routes that haven't been
  // updated to include the new `backend` field.
  const backend = data.backend ?? 'elevenlabs';

  switch (backend) {
    case 'elevenlabs':
      // ElevenLabs adapter is bundled inline — most consumers use it, and the
      // tree-shaking story for a static import is more predictable than for
      // every backend behind dynamic imports.
      return openElevenLabsSession(data, opts);

    case 'hume': {
      // Lazy-import — keeps `hume` SDK out of bundles when this branch is
      // never taken. If the SDK isn't installed, the import will throw and
      // the adapter file's own error path surfaces a clear "install hume" hint.
      const { openHumeSession } = await import('./hume-session');
      return openHumeSession(data, opts);
    }

    case 'cartesia-line':
    case 'openai-realtime':
      // Type slots reserved in v0.3.4; implementations targeted for v0.5+.
      // Throw a clear error so consumers know it's not yet wired.
      throw new ConvAIError({
        code: 'BACKEND_NOT_IMPLEMENTED',
        type: 'config_invalid',
        provider: backend,
        message: `Backend '${backend}' is not yet implemented in the React layer. ` +
          `Available React backends in v0.4.3: 'elevenlabs', 'hume'.`,
        retryable: false,
      });

    default: {
      // Exhaustiveness check — TypeScript will catch unhandled cases at
      // compile time, this runtime guard is for invalid JSON from a stale
      // route that returns a backend string not in the union.
      const exhaustive: never = backend;
      throw new ConvAIError({
        code: 'BACKEND_UNKNOWN',
        type: 'config_invalid',
        message: `Unknown backend '${exhaustive as string}' in agent route response.`,
        retryable: false,
      });
    }
  }
}
