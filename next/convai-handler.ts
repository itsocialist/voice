/**
 * Next.js ConvAI Route Handler
 *
 * Drop into app/api/convai/agent/route.ts:
 *   export { POST, DELETE } from '@itsocialist/voice/next/convai-handler'
 *
 * POST body: { systemPrompt, firstMessage, voiceId, agentName }
 * POST response: { agent_id, conversation_token?, signed_url? }
 * DELETE ?agent_id=xxx → { ok: true }
 */

import { createConvAIAgent, deleteConvAIAgent } from '../src/convai/client';
import type { ConvAIAgentRouteBody } from '../src/types';

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });
  }

  try {
    const body: ConvAIAgentRouteBody = await request.json();
    const { systemPrompt, firstMessage, voiceId, agentName } = body;

    if (!systemPrompt || !firstMessage || !voiceId) {
      return json({ error: 'systemPrompt, firstMessage, and voiceId are required' }, { status: 400 });
    }

    const result = await createConvAIAgent(
      { systemPrompt, firstMessage, voiceId, agentName: agentName ?? 'Agent' },
      apiKey
    );

    return json({
      agent_id: result.agentId,
      conversation_token: result.conversationToken,
      signed_url: result.signedUrl,
    });
  } catch (error) {
    console.error('[voice/convai] agent creation error:', error);
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

  await deleteConvAIAgent(agentId); // Best-effort; doesn't throw
  return json({ ok: true });
}
