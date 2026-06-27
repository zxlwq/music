async function extractPathFromRawUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'raw.githubusercontent.com') {
      const parts = u.pathname.split('/').filter(Boolean);

      if (parts.length >= 4) {
        const rest = parts.slice(3).join('/');
        return decodeURIComponent(rest);
      }
    }
  } catch {}
  return null;
}

function createProxyFetch(proxyUrl, builtinProxyUrl) {
  if (!proxyUrl && !builtinProxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[delete] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[delete] Direct request error: ${error.message}, trying proxy...`);
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
              'X-Proxy-Type': 'github-delete',
            },
          };

          console.log(`[delete] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          console.log(`[delete] Builtin proxy failed: ${error.message}`);
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
            'X-Proxy-Type': 'github-delete',
          },
        };

        console.log(`[delete] Using custom proxy: ${proxiedUrl}`);
        return fetch(proxiedUrl, proxyOptions);
      }
    }

    return fetch(url, options);
  };
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const { filePath, rawUrl, password } = await request.json();
    const expectedPassword = String(env.PASSWORD ?? '').trim();
    if (!expectedPassword) {
      return new Response(
        JSON.stringify({
          error: 'Delete is disabled: set a non-empty PASSWORD environment variable',
          code: 'PASSWORD_NOT_CONFIGURED',
        }),
        {
          status: 503,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
          },
        },
      );
    }
    if (String(password || '') !== expectedPassword) {
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'INVALID_PASSWORD' }), {
        status: 401,
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

    let pathInRepo = String(filePath || '').replace(/^\/+/, '');
    if (!pathInRepo && rawUrl) {
      const extracted = await extractPathFromRawUrl(rawUrl);
      if (extracted) pathInRepo = extracted;
    }
    if (!pathInRepo) {
      return new Response(JSON.stringify({ error: 'Missing filePath or rawUrl' }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (!/^public\/music\//.test(pathInRepo)) {
      return new Response(JSON.stringify({ error: 'Refusing to delete outside public/music' }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }

    const [owner, repo] = String(repoFull).split('/');
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;

    const metaRes = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)',
      },
    });
    if (metaRes.status === 404) {
      return new Response(JSON.stringify({ ok: true, skipped: true, message: 'File not found' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }
    if (!metaRes.ok) {
      const t = await metaRes.text();
      return new Response(JSON.stringify({ error: `Meta fetch failed: ${metaRes.status} ${t}` }), {
        status: metaRes.status,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }
    const meta = await metaRes.json();
    const sha = meta.sha;
    if (!sha) {
      return new Response(JSON.stringify({ error: 'File SHA not found' }), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }

    const delApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}`;
    const body = {
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
        'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)',
      },
      body: JSON.stringify(body),
    });
    if (!delRes.ok) {
      const t = await delRes.text();
      return new Response(JSON.stringify({ error: `Delete failed: ${delRes.status} ${t}` }), {
        status: delRes.status,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'delete error' }), {
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
