export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();

    if (body.action === 'getConfig') {
      const customProxyUrl = env.GIT_URL || '';
      const config = {
        customProxyUrl: customProxyUrl,
        hasCustomProxy: !!customProxyUrl,
      };

      return new Response(JSON.stringify(config), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'cache-control': 'public, max-age=300',
        },
      });
    }

    if (body.action === 'customProxy') {
      const { url } = body;
      const customProxyUrl = env.GIT_URL || '';
      const builtinProxyUrl = '/api/audio';

      if (!url || typeof url !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing url' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (!/^https?:\/\//i.test(url)) {
        return new Response(JSON.stringify({ error: 'Only http/https allowed' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      let proxyUrl = null;
      let proxyType = '';

      if (builtinProxyUrl) {
        try {
          proxyUrl = `${builtinProxyUrl}?url=${encodeURIComponent(url)}`;
          proxyType = 'builtin';
          console.log('[api/fetch] Trying builtin proxy:', { proxyUrl });
        } catch (error) {
          console.log('[api/fetch] Builtin proxy setup failed:', error.message);
        }
      }

      if (!proxyUrl && customProxyUrl) {
        proxyUrl = `${customProxyUrl}?url=${encodeURIComponent(url)}`;
        proxyType = 'custom';
        console.log('[api/fetch] Using custom proxy:', { proxyUrl });
      }

      if (!proxyUrl) {
        return new Response(JSON.stringify({ error: 'No proxy configured' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      try {
        console.log(`[api/fetch] ${proxyType} proxy request:`, { proxyUrl });
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
        console.log(`[api/fetch] ${proxyType} proxy upstream status:`, upstream.status);
        if (!upstream.ok) {
          return new Response(
            JSON.stringify({ error: `${proxyType} proxy upstream ${upstream.status}` }),
            {
              status: upstream.status,
              headers: { 'content-type': 'application/json' },
            },
          );
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
        console.log(`[api/fetch] ${proxyType} proxy success:`, {
          bytes: arrayBuf.byteLength,
          contentType: mime,
        });
        return new Response(JSON.stringify(resp), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
          },
        });
      } catch (error) {
        console.error(`[api/fetch] ${proxyType} proxy error:`, error);
        return new Response(
          JSON.stringify({ error: `${proxyType} proxy error: ${error.message}` }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
    }

    const { url } = body;
    console.log('[api/fetch] POST invoked', { url });
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (!/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: 'Only http/https allowed' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: upstream.status,
        headers: { 'content-type': 'application/json' },
      });
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
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    });
  } catch (e) {
    console.error('[api/fetch] error', e && e.stack ? e.stack : e);
    return new Response(JSON.stringify({ error: e.message || 'proxy error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
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
