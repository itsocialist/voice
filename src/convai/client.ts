/**
 * ElevenLabs ConvAI — Server-side client
 *
 * Creates and manages ephemeral ConvAI agents.
 * Returns both signed_url (legacy WebSocket) and conversation_token (WebRTC)
 * so consuming apps can choose whichever the ElevenLabs SDK version expects.
 */

import type { ConvAIAgentConfig, ConvAIAgentResult } from '../types';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

/**
 * Create an ephemeral ConvAI agent and return connection credentials.
 *
 * Notes:
 * - ConvAI TTS only accepts model_id: 'eleven_turbo_v2' or 'eleven_flash_v2'
 * - voice_id in tts config (not in agent.prompt) is the correct placement
 * - Returns both signed_url and conversation_token; use whichever your SDK needs
 */
export async function createConvAIAgent(
  config: ConvAIAgentConfig,
  apiKey?: string
): Promise<ConvAIAgentResult> {
  const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is required');

  // Step 1: Create agent
  const agentRes = await fetch(`${ELEVENLABS_API}/convai/agents/create`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: config.agentName,
      conversation_config: {
        agent: {
          prompt: { prompt: config.systemPrompt },
          first_message: config.firstMessage,
          // max_duration_seconds: SpeakerHero uses 3600 (1hr). ElevenLabs default is 600s (10min).
          max_duration_seconds: config.maxDurationSeconds ?? 3600,
        },
        tts: {
          voice_id: config.voiceId,
          model_id: 'eleven_turbo_v2_5', // Upgraded to v2.5 for faster TTFA
          stability: 0.4,
          similarity_boost: 0.75,
        },
      },
    }),
  });

  if (!agentRes.ok) {
    const err = await agentRes.text();
    throw new Error(`ConvAI agent creation failed (${agentRes.status}): ${err}`);
  }

  const { agent_id: agentId } = await agentRes.json();

  // Step 2 & 3: Get token and signed URL in parallel to reduce setup latency
  let conversationToken: string | undefined;
  let signedUrl: string | undefined;

  const [tokenRes, signedRes] = await Promise.all([
    fetch(`${ELEVENLABS_API}/convai/conversation/token?agent_id=${agentId}`, { method: 'GET', headers: { 'xi-api-key': key } }),
    fetch(`${ELEVENLABS_API}/convai/conversation/get_signed_url?agent_id=${agentId}`, { method: 'GET', headers: { 'xi-api-key': key } })
  ]);

  if (tokenRes.ok) {
    const tokenData = await tokenRes.json();
    conversationToken = tokenData.token;
  }

  if (signedRes.ok) {
    const signedData = await signedRes.json();
    signedUrl = signedData.signed_url;
  }

  return { agentId, conversationToken, signedUrl };
}

/** Delete an agent — call on session end for cleanup */
export async function deleteConvAIAgent(
  agentId: string,
  apiKey?: string
): Promise<void> {
  const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) return; // Best-effort; don't throw on cleanup

  await fetch(`${ELEVENLABS_API}/convai/agents/${agentId}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': key },
  }).catch(() => {}); // Swallow errors — cleanup is best-effort
}

/** Get a signed URL for an existing agent */
export async function getSignedUrl(
  agentId: string,
  apiKey?: string
): Promise<string> {
  const key = apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is required');

  const res = await fetch(
    `${ELEVENLABS_API}/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { method: 'GET', headers: { 'xi-api-key': key } }
  );

  if (!res.ok) {
    throw new Error(`Failed to get signed URL (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.signed_url;
}
