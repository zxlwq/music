function createProxyFetch(proxyUrl, builtinProxyUrl) {
  if (!proxyUrl && !builtinProxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[exists] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[exists] Direct request error: ${error.message}, trying proxy...`);
      }

      if (builtinProxyUrl) {
        try {
          const targetUrl = encodeURIComponent(url);
          const builtinProxiedUrl = `${builtinProxyUrl}?url=${targetUrl}`;

          const builtinOptions = {
            ...options,
            headers: {
              ...options.headers,
              'X-Target-URL': url,
              'X-Proxy-Type': 'github-exists',
            },
          };

          console.log(`[exists] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          console.log(`[exists] Builtin proxy failed: ${error.message}`);
        }
      }

      if (proxyUrl) {
        const targetUrl = encodeURIComponent(url);
        const proxiedUrl = `${proxyUrl}?target=${targetUrl}`;

        const proxyOptions = {
          ...options,
          headers: {
            ...options.headers,
            'X-Target-URL': url,
            'X-Proxy-Type': 'github-exists',
          },
        };

        console.log(`[exists] Using custom proxy: ${proxiedUrl}`);
        return fetch(proxiedUrl, proxyOptions);
      }
    }

    return fetch(url, options);
  };
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const { fileName } = await request.json();
    if (!fileName) {
      return new Response(JSON.stringify({ error: 'Missing fileName' }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }
    const repoFull = env.GIT_REPO;
    const token = env.GIT_TOKEN;
    const branch = env.GIT_BRANCH || 'main';

    const proxyUrl = env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);
    if (!repoFull || !token) {
      return new Response(
        JSON.stringify({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        },
      );
    }
    const [owner, repo] = String(repoFull).split('/');
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/public/music/${encodeURIComponent(fileName)}`;
    let exists;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2000);
      const head = await proxyFetch(rawUrl, { method: 'HEAD', signal: ac.signal });
      clearTimeout(t);
      if (head.status === 200) exists = true;
      else if (head.status === 404) exists = false;
    } catch {}
    if (exists === undefined) {
      const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodeURIComponent(fileName)}?ref=${encodeURIComponent(branch)}`;
      const meta = await proxyFetch(metaApi, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)',
        },
      });
      exists = meta.status === 200;
    }
    return new Response(JSON.stringify({ ok: true, exists }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'exists check error' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
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
      'cache-control': 'no-store',
    },
  });
};
