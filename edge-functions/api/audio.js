export function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Cache-Control': 'no-store',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  return handleAudioProxy(request, env, corsHeaders);
}

async function handleAudioProxy(request, env, corsHeaders) {
  try {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    const validateTargetUrl = (rawUrl) => {
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new Error('Invalid url parameter');
      }

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http(s) audio URLs are allowed');
      }

      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local')
      ) {
        throw new Error('Forbidden target hostname');
      }

      if (
        /^10\./.test(hostname) ||
        /^127\./.test(hostname) ||
        /^169\.254\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
        /^(?:fc00|fd00|fe80):/i.test(hostname)
      ) {
        throw new Error('Forbidden target address');
      }
    };

    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    try {
      validateTargetUrl(target);
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const incomingRange = request.headers.get('Range');
    const isRangeRequest = !!incomingRange;

    const reqHeaders = new Headers();

    const userAgent = request.headers.get('user-agent') || '';
    const isMobileChrome = /Android.*Chrome/i.test(userAgent);
    const isChrome = /Chrome/i.test(userAgent);

    if (isMobileChrome) {
      reqHeaders.set(
        'User-Agent',
        'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
      );
    } else if (isChrome) {
      reqHeaders.set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36',
      );
    } else {
      reqHeaders.set(
        'User-Agent',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      );
    }

    reqHeaders.set(
      'Accept',
      'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/m4a,audio/webm,audio/*,*/*;q=0.9',
    );
    reqHeaders.set('Accept-Encoding', 'identity');
    reqHeaders.set('Connection', 'keep-alive');
    reqHeaders.set('Accept-Ranges', 'bytes');

    if (isMobileChrome) {
      reqHeaders.set('X-Requested-With', 'XMLHttpRequest');
      reqHeaders.set('Sec-Fetch-Dest', 'audio');
      reqHeaders.set('Sec-Fetch-Mode', 'cors');
      reqHeaders.set('Sec-Fetch-Site', 'cross-site');
      reqHeaders.set('DNT', '1');
      reqHeaders.set('Upgrade-Insecure-Requests', '1');
    }

    if (incomingRange) {
      reqHeaders.set('Range', incomingRange);
      reqHeaders.set('X-Requested-With', 'Range');
    }

    try {
      const u = new URL(target);
      reqHeaders.set('Referer', `${u.origin}/`);
      reqHeaders.set('Origin', u.origin);
    } catch {}

    const maxRetries = isMobileChrome ? 2 : 1;
    let lastError = null;
    let upstream = null;

    for (let i = 0; i <= maxRetries; i++) {
      try {
        const controller = new AbortController();
        const timeout = isMobileChrome
          ? isRangeRequest
            ? 15000
            : 20000
          : isRangeRequest
            ? 10000
            : 15000;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        upstream = await fetch(target, {
          redirect: 'follow',
          headers: reqHeaders,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (upstream.ok || (upstream.status >= 200 && upstream.status < 400)) break;
        lastError = new Error(`Upstream ${upstream.status}`);
        console.warn(`Proxy attempt ${i + 1} failed: ${upstream.status}`);
      } catch (e) {
        lastError = e;
        console.warn(`Proxy attempt ${i + 1} failed:`, e.message);
      }
      if (i < maxRetries) {
        const retryDelay = isMobileChrome ? 500 : 100;
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }

    if (!upstream || !upstream.body || upstream.status >= 400) {
      const status = upstream ? upstream.status : 502;
      const msg = lastError?.message || `Upstream ${status}`;
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const respHeaders = new Headers();
    let ct = upstream.headers.get('content-type') || '';
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');
    const ar = upstream.headers.get('accept-ranges') || 'bytes';

    const lowerUrl = target.toLowerCase();
    const inferAudioType = () => {
      if (lowerUrl.endsWith('.mp3')) return 'audio/mpeg';
      if (lowerUrl.endsWith('.wav')) return 'audio/wav';
      if (lowerUrl.endsWith('.ogg')) return 'audio/ogg';
      if (lowerUrl.endsWith('.m4a')) return 'audio/mp4';
      if (lowerUrl.endsWith('.flac')) return 'audio/flac';
      return '';
    };

    const trimmedType = ct.trim().toLowerCase();
    if (!trimmedType.startsWith('audio/')) {
      if (
        trimmedType === '' ||
        trimmedType === 'application/octet-stream' ||
        trimmedType === 'binary/octet-stream'
      ) {
        const inferred = inferAudioType();
        if (!inferred) {
          return new Response(
            JSON.stringify({
              error: `Unsupported upstream content type: ${trimmedType || 'unknown'}`,
            }),
            {
              status: 415,
              headers: {
                'content-type': 'application/json',
                'access-control-allow-origin': '*',
                'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges',
              },
            },
          );
        }
        ct = inferred;
      } else {
        return new Response(
          JSON.stringify({ error: `Unsupported upstream content type: ${trimmedType}` }),
          {
            status: 415,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': '*',
              'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges',
            },
          },
        );
      }
    }

    respHeaders.set('Content-Type', ct);
    if (cl) respHeaders.set('Content-Length', cl);
    if (cr) respHeaders.set('Content-Range', cr);
    respHeaders.set('Accept-Ranges', ar);
    respHeaders.set('Cache-Control', 'public, max-age=7200, must-revalidate');
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.set(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges',
    );
    respHeaders.set('X-Content-Type-Options', 'nosniff');

    if (isMobileChrome) {
      respHeaders.set('X-Chrome-Mobile', 'true');
      respHeaders.set('X-Mobile-Optimized', 'true');
      respHeaders.set('X-Audio-Streaming', 'enabled');
      respHeaders.set('X-Range-Support', 'bytes');
    }

    const isPartial = !!incomingRange && (cr || upstream.status === 206);
    const statusCode = isPartial ? 206 : upstream.status || 200;

    return new Response(upstream.body, {
      status: statusCode,
      headers: respHeaders,
    });
  } catch (e) {
    console.error('Audio proxy error:', e);
    return new Response(JSON.stringify({ error: e.message || 'audio proxy error' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}
