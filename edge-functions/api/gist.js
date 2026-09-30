import { runUserDataSync } from '../../lib/sync.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '方法不允许' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  return handleGist(request, env, corsHeaders);
}

async function handleGist(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { status, body: json } = await runUserDataSync(body, env, {
      userAgent: 'web-music-player/0.1 (EdgeOne Pages Function)',
      builtinProxyUrl: '/api/audio',
    });
    return new Response(JSON.stringify(json), {
      status,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('Gist error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Gist 操作失败' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}
