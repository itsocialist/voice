/**
 * Next.js ConvAI Route Handler — ElevenLabs default.
 *
 * Drop into app/api/convai/agent/route.ts:
 *   export { POST, DELETE } from '@itsocialist/voice/next/convai-handler'
 *
 * POST body (v0.4.0+ nested shape):
 *   { agent: { systemPrompt, firstMessage, voiceId, agentName },
 *     llm?, tts?, vad?, session? }
 *
 * POST response: { backend: 'elevenlabs', agent_id, conversation_token?, signed_url? }
 * DELETE ?agent_id=xxx → { ok: true }
 *
 * **Wiring Hume from this route** is a v0.4.4 concern (createConvAIHandler
 * factory). For v0.4.3, if you want a Hume-backed agent route, write your
 * own POST handler that uses `createConvAI({ backend: hume({...}) })`
 * server-side and returns the response shape:
 *
 *   { backend: 'hume', agent_id, signed_url }
 *
 * The React-side useConversation dispatches on the `backend` field, so
 * you can have one route returning ElevenLabs sessions and another
 * returning Hume sessions — the hook picks the right adapter per request.
 */

import { createConvAIAgent, deleteConvAIAgent, ConvAIError } from '../src/convai/client';
import type { ConvAIAgentRouteBody } from '../src/types';

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/**
 * Required-field check on the request body. Nested shape only since v0.4.0.
 */
function validateBody(body: ConvAIAgentRouteBody): string | null {
  const agent = body.agent;
  if (!agent?.systemPrompt) return 'agent.systemPrompt is required';
  if (!agent?.firstMessage) return 'agent.firstMessage is required';
  if (!agent?.voiceId) return 'agent.voiceId is required';
  return null;
}

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });
  }

  try {
    const body: ConvAIAgentRouteBody = await request.json();
    const validationError = validateBody(body);
    if (validationError) {
      return json({ error: validationError }, { status: 400 });
    }

    // Default agentName if missing
    body.agent = { ...body.agent, agentName: body.agent.agentName ?? 'Agent' };

    const result = await createConvAIAgent(body, apiKey);

    return json({
      // v0.4.3: backend field surfaces to the React-side useConversation hook
      // so it can dispatch to the right session adapter. The bundled default
      // handler is hard-wired to ElevenLabs; custom Hume routes return 'hume'.
      backend: 'elevenlabs',
      agent_id: result.agentId,
      conversation_token: result.conversationToken,
      signed_url: result.signedUrl,
    });
  } catch (error) {
    console.error('[voice/convai] agent creation error:', error);

    if (error instanceof ConvAIError) {
      // Map error type → HTTP status. type is the canonical retry-routing
      // axis in v0.3.1+; legacy code field still set for backward compat.
      const httpStatus =
        error.type === 'auth' ? 500
        : error.type === 'upstream_unavailable' ? 503
        : error.type === 'rate_limit' ? 429
        : error.type === 'config_invalid' ? 400
        : error.status ?? 500;
      return json(
        { error: error.message, code: error.code, type: error.type, retryable: error.retryable },
        { status: httpStatus },
      );
    }

    return json(
      { error: error instanceof Error ? error.message : 'Failed to create agent' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const agentId = new URL(request.url).searchParams.get('agent_id');
  if (!agentId) {
    return json({ error: 'agent_id required' }, { status: 400 });
  }

  await deleteConvAIAgent(agentId, {
    onError: (e) => console.warn('[voice/convai] agent cleanup failed:', e),
  });
  return json({ ok: true });
}
