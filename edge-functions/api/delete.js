function createProxyFetch(proxyUrl) {
  if (!proxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`Direct request error: ${error.message}, trying proxy...`);
      }

      const targetUrl = encodeURIComponent(url);
      const proxiedUrl = `${proxyUrl}?target=${targetUrl}`;

      const proxyOptions = {
        ...options,
        headers: {
          ...options.headers,
          'X-Target-URL': url,
          'X-Proxy-Type': 'github-api',
        },
      };

      console.log(`Using proxy: ${proxiedUrl}`);
      return fetch(proxiedUrl, proxyOptions);
    }

    return fetch(url, options);
  };
}

export function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  return handleDelete(request, env, corsHeaders);
}

async function handleDelete(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { filePath, rawUrl, password } = body;
    const expectedPassword = String(env.PASSWORD ?? '').trim();

    if (!expectedPassword) {
      return new Response(
        JSON.stringify({
          error: 'Delete is disabled: set a non-empty PASSWORD environment variable',
          code: 'PASSWORD_NOT_CONFIGURED',
        }),
        {
          status: 503,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }
    if (String(password || '') !== expectedPassword) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          code: 'INVALID_PASSWORD',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }

    const repoFull = env.GIT_REPO;
    const token = env.GIT_TOKEN;
    const branch = env.GIT_BRANCH || 'main';
    const proxyUrl = env.GIT_URL;
    const proxyFetch = createProxyFetch(proxyUrl);

    if (!repoFull || !token) {
      return new Response(
        JSON.stringify({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }

    let pathInRepo = String(filePath || '').replace(/^\/+/, '');
    if (!pathInRepo && rawUrl) {
      try {
        const u = new URL(rawUrl);
        if (u.hostname === 'raw.githubusercontent.com') {
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 4) {
            const rest = parts.slice(3).join('/');
            pathInRepo = decodeURIComponent(rest);
          }
        }
      } catch {}
    }

    if (!pathInRepo) {
      return new Response(JSON.stringify({ error: 'Missing filePath or rawUrl' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    if (!/^public\/music\//.test(pathInRepo)) {
      return new Response(JSON.stringify({ error: 'Refusing to delete outside public/music' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const [owner, repo] = String(repoFull).split('/');
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;

    const metaRes = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (EdgeOne Pages Function)',
      },
    });

    if (metaRes.status === 404) {
      return new Response(JSON.stringify({ ok: true, skipped: true, message: 'File not found' }), {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    if (!metaRes.ok) {
      const t = await metaRes.text();
      return new Response(JSON.stringify({ error: `Meta fetch failed: ${metaRes.status} ${t}` }), {
        status: metaRes.status,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const meta = await metaRes.json();
    const sha = meta.sha;
    if (!sha) {
      return new Response(JSON.stringify({ error: 'File SHA not found' }), {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const delApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}`;
    const delBody = {
      message: `Delete music: ${pathInRepo}`,
      sha,
      branch,
    };

    const delRes = await proxyFetch(delApi, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'web-music-player/0.1 (EdgeOne Pages Function)',
      },
      body: JSON.stringify(delBody),
    });

    if (!delRes.ok) {
      const t = await delRes.text();
      return new Response(JSON.stringify({ error: `Delete failed: ${delRes.status} ${t}` }), {
        status: delRes.status,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('Delete error:', e);
    return new Response(JSON.stringify({ error: e.message || 'delete error' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}
