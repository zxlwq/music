// 保留以备将来使用
// eslint-disable-next-line no-unused-vars
function createProxyFetch(proxyUrl, builtinProxyUrl) {
  if (!proxyUrl && !builtinProxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[fetch] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[fetch] Direct request error: ${error.message}, trying proxy...`);
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
              'X-Proxy-Type': 'github-fetch',
            },
          };

          console.log(`[fetch] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          console.log(`[fetch] Builtin proxy failed: ${error.message}`);
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
            'X-Proxy-Type': 'github-fetch',
          },
        };

        console.log(`[fetch] Using custom proxy: ${proxiedUrl}`);
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
    const body = req.body;

    if (body.action === 'getConfig') {
      const customProxyUrl = process.env.GIT_URL || '';
      const config = {
        customProxyUrl: customProxyUrl,
        hasCustomProxy: !!customProxyUrl,
      };

      return res.status(200).json(config);
    }

    if (body.action === 'customProxy') {
      const { url } = body;
      const customProxyUrl = process.env.GIT_URL || '';

      if (!customProxyUrl) {
        return res.status(400).json({ error: 'Custom proxy not configured' });
      }

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url' });
      }

      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'Only http/https allowed' });
      }

      try {
        const proxyUrl = `${customProxyUrl}?url=${encodeURIComponent(url)}`;
        console.log('[api/fetch] Custom proxy request:', { proxyUrl });
        const headers = {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept:
            'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/m4a,audio/webm,audio/*,*/*;q=0.9',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const upstream = await fetch(proxyUrl, {
          redirect: 'follow',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        console.log('[api/fetch] Custom proxy upstream status:', upstream.status);
        if (!upstream.ok) {
          return res
            .status(upstream.status)
            .json({ error: `Custom proxy upstream ${upstream.status}` });
        }
        const arrayBuf = await upstream.arrayBuffer();
        const fileSize = arrayBuf.byteLength;
        const isLargeFile = fileSize > 5 * 1024 * 1024;

        const toBase64 = async (buffer) => {
          const bytes = new Uint8Array(buffer);
          const chunkSize = isLargeFile ? 0x4000 : 0x8000;
          let binary = '';
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const sub = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, sub);
            if (isLargeFile && i % (chunkSize * 10) === 0) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          return btoa(binary);
        };
        const base64 = await toBase64(arrayBuf);
        const mime = upstream.headers.get('content-type') || 'application/octet-stream';
        const resp = { base64, contentType: mime };
        console.log('[api/fetch] Custom proxy success:', {
          bytes: arrayBuf.byteLength,
          contentType: mime,
        });
        return res.status(200).json(resp);
      } catch (error) {
        console.error('[api/fetch] Custom proxy error:', error);
        return res.status(500).json({ error: `Custom proxy error: ${error.message}` });
      }
    }

    const { url } = body;
    console.log('[api/fetch] POST invoked', { url });
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url' });
    }
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Only http/https allowed' });
    }

    const headers = {};
    try {
      const u = new URL(url);
      headers['Referer'] = `${u.origin}/`;
    } catch {}
    headers['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

    const upstream = await fetch(url, { redirect: 'follow', headers });
    console.log('[api/fetch] upstream status', upstream.status);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }

    const arrayBuf = await upstream.arrayBuffer();
    const toBase64 = (buffer) => {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const sub = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, sub);
      }
      return btoa(binary);
    };
    const base64 = toBase64(arrayBuf);
    const mime = upstream.headers.get('content-type') || 'application/octet-stream';
    const resp = { base64, contentType: mime };
    console.log('[api/fetch] success', { bytes: arrayBuf.byteLength, contentType: mime });
    return res.status(200).json(resp);
  } catch (e) {
    console.error('[api/fetch] error', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: e.message || 'proxy error' });
  }
}
