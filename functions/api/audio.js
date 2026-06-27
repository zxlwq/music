export const onRequest = async ({ request, env: _env, ctx }) => {
  const startTime = Date.now();

  try {
    const urlObj = new URL(request.url);
    let target = urlObj.searchParams.get('url');

    if (!target && request.method === 'POST') {
      try {
        const body = await request.clone().json();
        target = body.target || body.url;
      } catch {}
    }

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
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        },
      });
    }

    try {
      validateTargetUrl(target);
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        },
      });
    }

    const cache = caches.default;
    const incomingRange = request.headers.get('Range');
    const isRangeRequest = !!incomingRange;

    if (isRangeRequest) {
      const preloadCacheKey = new Request(`${target}?preload=1mb`, request);
      const preloadCached = await cache.match(preloadCacheKey);

      if (preloadCached) {
        console.log('Preload cache hit for:', target);
        return new Response(preloadCached.body, {
          status: preloadCached.status,
          statusText: preloadCached.statusText,
          headers: {
            ...Object.fromEntries(preloadCached.headers),
            'X-Cache-Status': 'HIT',
            'X-Processing-Time': `${Date.now() - startTime}ms`,
            'X-Cache-Source': 'Preload',
          },
        });
      }
    }

    const cacheKey = new Request(target, request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('Full cache hit for:', target);
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: {
          ...Object.fromEntries(cachedResponse.headers),
          'X-Cache-Status': 'HIT',
          'X-Processing-Time': `${Date.now() - startTime}ms`,
          'X-Cache-Source': 'Edge',
        },
      });
    }

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

        const fetchOptions = {
          redirect: 'follow',
          headers: reqHeaders,
          signal: controller.signal,
        };

        if (request.method === 'POST') {
          fetchOptions.method = 'POST';
          fetchOptions.body = request.body;
          fetchOptions.headers.set(
            'Content-Type',
            request.headers.get('content-type') || 'application/json',
          );
        }

        upstream = await fetch(target, fetchOptions);
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
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        },
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
                'cache-control': 'no-store',
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
              'cache-control': 'no-store',
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

    const processingTime = Date.now() - startTime;
    respHeaders.set('X-Processing-Time', `${processingTime}ms`);
    respHeaders.set('X-Request-Type', isRangeRequest ? 'Range' : 'Full');
    respHeaders.set('X-Retries', `${maxRetries}`);
    respHeaders.set('X-Cache-Status', 'MISS');
    respHeaders.set('X-Cache-Source', 'Origin');

    const response = new Response(upstream.body, {
      status: statusCode,
      headers: respHeaders,
    });

    if (!isRangeRequest && statusCode === 200) {
      const cacheResponse = response.clone();
      cacheResponse.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      cacheResponse.headers.set('X-Cache-TTL', '86400');

      const doWait = ctx && typeof ctx.waitUntil === 'function';

      const cacheTask = (async () => {
        try {
          await cache.put(cacheKey, cacheResponse);
          console.log('Cached audio file:', target);
        } catch (err) {
          console.warn('Cache store failed:', err.message || err);
        }
      })();

      const preloadTask = (async () => {
        try {
          await new Promise((r) => setTimeout(r, 100));
          const preloadHeaders = new Headers(reqHeaders);

          const preloadSize = isMobileChrome ? 1048576 : 2097151;
          preloadHeaders.set(`Range`, `bytes=0-${preloadSize - 1}`);

          const preloadResponse = await fetch(target, {
            headers: preloadHeaders,
            signal: AbortSignal.timeout(isMobileChrome ? 12000 : 8000),
          });

          if (preloadResponse.ok && preloadResponse.status === 206) {
            const preloadCacheKey = new Request(
              `${target}?preload=${isMobileChrome ? '1mb' : '2mb'}`,
              request,
            );
            const preloadCacheResponse = preloadResponse.clone();
            preloadCacheResponse.headers.set('Cache-Control', 'public, max-age=3600');
            preloadCacheResponse.headers.set('X-Preload', isMobileChrome ? '1MB' : '2MB');
            preloadCacheResponse.headers.set(
              'X-Mobile-Optimized',
              isMobileChrome ? 'true' : 'false',
            );
            preloadCacheResponse.headers.set('X-Chrome-Mobile', isMobileChrome ? 'true' : 'false');
            await cache.put(preloadCacheKey, preloadCacheResponse);
            console.log(
              `Preloaded ${isMobileChrome ? '1MB' : '2MB'} for ${isMobileChrome ? 'mobile Chrome' : 'standard'} optimization:`,
              target,
            );
          }
        } catch (err) {
          console.warn('Preload failed:', err.message || err);
        }
      })();

      if (doWait) {
        ctx.waitUntil(cacheTask);
        ctx.waitUntil(preloadTask);
      }
    }

    return response;
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'audio proxy error' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    });
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      'access-control-allow-headers': 'range, content-type, authorization',
      'cache-control': 'no-store',
    },
  });
};
