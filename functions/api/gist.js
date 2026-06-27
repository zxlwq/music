import { runUserDataSync } from '../../lib/sync.js';

const jsonHeaders = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    const { status, body: json } = await runUserDataSync(body, env, {
      userAgent: 'web-music-player/0.1 (Cloudflare Pages Function)',
      builtinProxyUrl: '/api/audio',
    });
    return new Response(JSON.stringify(json), {
      status,
      headers: jsonHeaders,
    });
  } catch (e) {
    console.error('Gist error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Gist 操作失败' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
};
