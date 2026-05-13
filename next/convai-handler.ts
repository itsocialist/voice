/**
 * Next.js ConvAI Route Handler
 *
 * Drop into app/api/convai/agent/route.ts:
 *   export { POST, DELETE } from '@itsocialist/voice/next/convai-handler'
 *
 * POST body accepts either:
 *   - Nested v0.3.1+ shape:
 *       { agent: { systemPrompt, firstMessage, voiceId, agentName },
 *         llm?, tts?, vad?, session? }
 *   - Legacy flat v0.2.x shape: { systemPrompt, firstMessage, voiceId, ... }
 *     (deprecated, removed in v0.4.0).
 *
 * POST response: { agent_id, conversation_token?, signed_url? }
 * DELETE ?agent_id=xxx → { ok: true }
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
