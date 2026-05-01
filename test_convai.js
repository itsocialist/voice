const https = require('https');
const fs = require('fs');

const env = fs.readFileSync('../sales-sim-trainer/app/.env.local', 'utf8');
const match = env.match(/ELEVENLABS_API_KEY=(.+)/);
const key = match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;

const data = JSON.stringify({
  name: "Latency Test",
  conversation_config: {
    agent: {
      prompt: { prompt: "You are a fast agent.", llm: "gpt-4o-mini" },
      first_message: "Hello!",
      max_duration_seconds: 3600
    },
    tts: {
      voice_id: "pNInz6obpgDQGcFmaJcg",
      model_id: "eleven_flash_v2_5"
    }
  }
});

const req = https.request({
  hostname: 'api.elevenlabs.io',
  path: '/v1/convai/agents/create',
  method: 'POST',
  headers: {
    'xi-api-key': key,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('STATUS:', res.statusCode, 'BODY:', body));
});

req.on('error', console.error);
req.write(data);
req.end();
