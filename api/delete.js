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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { filePath, rawUrl, password } = req.body;
    const expectedPassword = String(process.env.PASSWORD ?? '').trim();

    if (!expectedPassword) {
      return res.status(503).json({
        error: 'Delete is disabled: set a non-empty PASSWORD environment variable',
        code: 'PASSWORD_NOT_CONFIGURED',
      });
    }
    if (String(password || '') !== expectedPassword) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'INVALID_PASSWORD',
      });
    }

    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';
    const proxyUrl = process.env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

    if (!repoFull || !token) {
      return res.status(500).json({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' });
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
      return res.status(400).json({ error: 'Missing filePath or rawUrl' });
    }

    if (!/^public\/music\//.test(pathInRepo)) {
      return res.status(400).json({ error: 'Refusing to delete outside public/music' });
    }

    const [owner, repo] = String(repoFull).split('/');
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;

    const metaRes = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (Vercel Function)',
      },
    });

    if (metaRes.status === 404) {
      return res.status(200).json({ ok: true, skipped: true, message: 'File not found' });
    }

    if (!metaRes.ok) {
      const t = await metaRes.text();
      return res
        .status(metaRes.status)
        .json({ error: `Meta fetch failed: ${metaRes.status} ${t}` });
    }

    const meta = await metaRes.json();
    const sha = meta.sha;
    if (!sha) {
      return res.status(500).json({ error: 'File SHA not found' });
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
        'User-Agent': 'web-music-player/0.1 (Vercel Function)',
      },
      body: JSON.stringify(body),
    });

    if (!delRes.ok) {
      const t = await delRes.text();
      return res.status(delRes.status).json({ error: `Delete failed: ${delRes.status} ${t}` });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: e.message || 'delete error' });
  }
}
