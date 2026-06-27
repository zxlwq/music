function arrayBufferToBase64(buf) {
  try {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  } catch {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
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
        console.log(`[upload] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[upload] Direct request error: ${error.message}, trying proxy...`);
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
              'X-Proxy-Type': 'github-upload',
            },
          };

          console.log(`[upload] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          console.log(`[upload] Builtin proxy failed: ${error.message}`);
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
            'X-Proxy-Type': 'github-upload',
          },
        };

        console.log(`[upload] Using custom proxy: ${proxiedUrl}`);
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
    const ct = req.headers['content-type'] || '';
    let fileName = '';
    let base64 = '';
    let sourceUrl = '';

    const proxyUrl = process.env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

    if (/multipart\/form-data/i.test(ct)) {
      const formData = await req.formData();
      const file = formData.get('file');
      fileName = formData.get('fileName') || '';

      if (!fileName && file && file.name) fileName = file.name;
      if (!fileName) {
        return res.status(400).json({ error: 'Missing fileName' });
      }

      if (file && file.arrayBuffer) {
        const buffer = await file.arrayBuffer();
        base64 = arrayBufferToBase64(buffer);
      } else {
        return res.status(400).json({ error: 'Missing file data' });
      }
    } else {
      const body = req.body;
      fileName = body?.fileName || '';
      base64 = body?.base64 || '';
      sourceUrl = body?.sourceUrl || '';
      if (!fileName) {
        return res.status(400).json({ error: 'Missing fileName' });
      }
    }

    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';

    if (!repoFull || !token) {
      return res.status(500).json({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' });
    }

    const [owner, repo] = String(repoFull).split('/');
    const encodedName = encodeURIComponent(fileName);
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}?ref=${encodeURIComponent(branch)}`;
    const meta = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (Vercel Function)',
      },
    });

    if (meta.status === 200) {
      return res.status(409).json({ error: 'File already exists', exists: true });
    }

    let contentB64 = base64;
    if (!contentB64) {
      if (!sourceUrl) {
        return res.status(400).json({ error: 'Missing base64 or sourceUrl' });
      }
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 30000);
        const upstream = await proxyFetch(sourceUrl, {
          redirect: 'follow',
          signal: ac.signal,
          headers: {
            'User-Agent': 'web-music-player/0.1',
            Accept: 'application/octet-stream',
          },
        });
        clearTimeout(t);
        if (!upstream.ok) {
          const text = await upstream.text().catch(() => '');
          return res
            .status(502)
            .json({ error: `Fetch source failed: ${upstream.status} ${text || ''}`.trim() });
        }
        const buf = await upstream.arrayBuffer();
        contentB64 = arrayBufferToBase64(buf);
      } catch (e) {
        return res.status(502).json({ error: e.message || 'Fetch source error' });
      }
    }

    const api = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}`;
    const putRes = await proxyFetch(api, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'web-music-player/0.1 (Vercel Function)',
      },
      body: JSON.stringify({
        message: `Add music: ${fileName}`,
        content: contentB64,
        branch,
      }),
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return res.status(putRes.status).json({ error: t });
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/public/music/${encodedName}`;
    res.status(200).json({ ok: true, rawUrl });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message || 'upload error' });
  }
}
