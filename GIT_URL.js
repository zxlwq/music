export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();

    const detectPlatform = () => {
      const userAgent = request.headers.get('User-Agent') || '';
      const host = request.headers.get('Host') || '';
      const cfRay = request.headers.get('CF-Ray');
      const xForwardedFor = request.headers.get('X-Forwarded-For');

      if (cfRay || host.includes('workers.dev') || host.includes('cloudflare')) {
        return 'cloudflare-workers';
      }

      if (host.includes('pages.dev') || userAgent.includes('Cloudflare-Pages')) {
        return 'cloudflare-pages';
      }

      if (host.includes('vercel.app') || host.includes('vercel.com')) {
        return 'vercel';
      }

      if (host.includes('edgeone.app') || userAgent.includes('EdgeOne')) {
        return 'edgeone';
      }

      if (xForwardedFor || userAgent.includes('Docker')) {
        return 'docker';
      }

      return 'unknown';
    };

    const platform = detectPlatform();

    const getPlatformConfig = (platform) => {
      const configs = {
        'cloudflare-workers': {
          cacheTtl: 86400,
          preloadSize: 1048576,
          timeout: 15000,
          retries: 1,
          description: 'Cloudflare Workers',
        },
        'cloudflare-pages': {
          cacheTtl: 43200,
          preloadSize: 2097152,
          timeout: 12000,
          retries: 2,
          description: 'Cloudflare Pages',
        },
        vercel: {
          cacheTtl: 7200,
          preloadSize: 2097152,
          timeout: 10000,
          retries: 1,
        },
        edgeone: {
          cacheTtl: 3600,
          preloadSize: 1048576,
          timeout: 12000,
          retries: 2,
        },
        docker: {
          cacheTtl: 1800,
          preloadSize: 524288,
          timeout: 8000,
          retries: 1,
        },
        unknown: {
          cacheTtl: 3600,
          preloadSize: 1048576,
          timeout: 10000,
          retries: 1,
        },
      };
      return configs[platform] || configs.unknown;
    };

    const platformConfig = getPlatformConfig(platform);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Range, If-Range, If-Modified-Since',
          'Access-Control-Expose-Headers':
            'Content-Length, Content-Range, Accept-Ranges, X-Processing-Time, X-Cache-Status',
          'Access-Control-Max-Age': '86400',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const url = new URL(request.url);
      const targetUrl = url.searchParams.get('url');

      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return new Response('Invalid URL', { status: 400 });
      }

      const cache = caches.default;
      const incomingRange = request.headers.get('Range');
      const isRangeRequest = !!incomingRange;

      if (isRangeRequest) {
        const preloadCacheKey = new Request(`${targetUrl}?preload=1mb`, request);
        const preloadCached = await cache.match(preloadCacheKey);
        if (preloadCached) {
          const response = new Response(preloadCached.body, {
            status: preloadCached.status,
            statusText: preloadCached.statusText,
            headers: {
              ...Object.fromEntries(preloadCached.headers),
              'X-Cache-Status': 'HIT',
              'X-Processing-Time': `${Date.now() - startTime}ms`,
              'X-Cache-Source': 'Preload',
              'X-Proxy-Platform':
                platform === 'cloudflare-workers'
                  ? 'Cloudflare Workers'
                  : platform === 'cloudflare-pages'
                    ? 'Cloudflare Pages'
                    : platform === 'vercel'
                      ? 'Vercel Functions'
                      : platform === 'edgeone'
                        ? 'EdgeOne Functions'
                        : platform === 'docker'
                          ? 'Docker Container'
                          : 'Multi-Platform Proxy',
            },
          });
          return response;
        }
      } else {
        const fullCacheKey = new Request(targetUrl, request);
        const cachedResponse = await cache.match(fullCacheKey);
        if (cachedResponse) {
          const response = new Response(cachedResponse.body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers: {
              ...Object.fromEntries(cachedResponse.headers),
              'X-Cache-Status': 'HIT',
              'X-Processing-Time': `${Date.now() - startTime}ms`,
              'X-Cache-Source': 'Edge',
              'X-Proxy-Platform':
                platform === 'cloudflare-workers'
                  ? 'Cloudflare Workers'
                  : platform === 'cloudflare-pages'
                    ? 'Cloudflare Pages'
                    : platform === 'vercel'
                      ? 'Vercel Functions'
                      : platform === 'edgeone'
                        ? 'EdgeOne Functions'
                        : platform === 'docker'
                          ? 'Docker Container'
                          : 'Multi-Platform Proxy',
            },
          });
          return response;
        }
      }

      const reqHeaders = new Headers();

      const getUserAgent = (targetUrl) => {
        const userAgents = [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        ];
        const hash = targetUrl.split('').reduce((a, b) => {
          a = (a << 5) - a + b.charCodeAt(0);
          return a & a;
        }, 0);
        const index = Math.abs(hash) % userAgents.length;
        return userAgents[index];
      };

      reqHeaders.set('User-Agent', getUserAgent(targetUrl));
      reqHeaders.set(
        'Accept',
        'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/m4a,audio/webm,audio/*,*/*;q=0.9',
      );
      reqHeaders.set('Accept-Encoding', 'identity');
      reqHeaders.set('Connection', 'keep-alive');
      reqHeaders.set('Cache-Control', 'no-cache');
      if (incomingRange) reqHeaders.set('Range', incomingRange);

      const isGitHubRaw = targetUrl.includes('raw.githubusercontent.com');
      if (isGitHubRaw) {
        reqHeaders.set('Accept', '*/*');
        reqHeaders.set('Cache-Control', 'no-cache');
        reqHeaders.set('Pragma', 'no-cache');
      }

      try {
        const u = new URL(targetUrl);
        reqHeaders.set('Referer', `${u.origin}/`);
        reqHeaders.set('Origin', u.origin);
      } catch {}

      const maxRetries = platformConfig.retries;
      let lastError = null;
      let upstream = null;

      for (let i = 0; i <= maxRetries; i++) {
        try {
          const controller = new AbortController();

          const timeout = isGitHubRaw
            ? isRangeRequest
              ? platformConfig.timeout
              : platformConfig.timeout * 1.5
            : isRangeRequest
              ? platformConfig.timeout * 0.8
              : platformConfig.timeout;
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          upstream = await fetch(targetUrl, {
            headers: reqHeaders,
            signal: controller.signal,
            redirect: 'follow',
          });

          clearTimeout(timeoutId);
          if (upstream.ok || (upstream.status >= 200 && upstream.status < 400)) break;
          lastError = new Error(`Upstream ${upstream.status}`);
        } catch (e) {
          lastError = e;
        }
        if (i < maxRetries) await new Promise((r) => setTimeout(r, 100));
      }

      if (!upstream || !upstream.body || upstream.status >= 400) {
        const status = upstream ? upstream.status : 502;
        const msg = lastError ? lastError.message || String(lastError) : `Upstream ${status}`;
        return new Response(JSON.stringify({ error: msg }), {
          status,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
            'X-Proxy-Platform':
              platform === 'cloudflare-workers'
                ? 'Cloudflare Workers'
                : platform === 'cloudflare-pages'
                  ? 'Cloudflare Pages'
                  : platform === 'vercel'
                    ? 'Vercel Functions'
                    : platform === 'edgeone'
                      ? 'EdgeOne Functions'
                      : platform === 'docker'
                        ? 'Docker Container'
                        : 'Multi-Platform Proxy',
          },
        });
      }

      const mimeMap = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4',
        '.webm': 'audio/webm',
      };

      let contentType = upstream.headers.get('content-type') || '';
      if (!/^audio\//.test(contentType)) {
        try {
          const ext = targetUrl.split('.').pop()?.toLowerCase();
          if (ext && mimeMap['.' + ext]) {
            contentType = mimeMap['.' + ext];
          } else {
            contentType = 'audio/mpeg';
          }
        } catch {
          contentType = 'audio/mpeg';
        }
      }

      const respHeaders = new Headers();
      respHeaders.set('Content-Type', contentType);
      ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'].forEach((h) => {
        const val = upstream.headers.get(h);
        if (val) respHeaders.set(h, val);
      });
      respHeaders.set(
        'Cache-Control',
        `public, max-age=${platformConfig.cacheTtl}, must-revalidate`,
      );
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      respHeaders.set(
        'Access-Control-Allow-Headers',
        'Range, Content-Range, If-Range, If-Modified-Since',
      );
      respHeaders.set(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges, X-Processing-Time, X-Cache-Status',
      );
      respHeaders.set('X-Content-Type-Options', 'nosniff');
      respHeaders.set('X-Processing-Time', `${Date.now() - startTime}ms`);
      respHeaders.set('X-Request-Type', isRangeRequest ? 'Range' : 'Full');
      respHeaders.set('X-Retries', `${maxRetries}`);
      respHeaders.set('X-Cache-Status', 'MISS');
      respHeaders.set('X-Cache-Source', 'Origin');
      respHeaders.set(
        'X-Proxy-Platform',
        platform === 'cloudflare-workers'
          ? 'Cloudflare Workers'
          : platform === 'cloudflare-pages'
            ? 'Cloudflare Pages'
            : platform === 'vercel'
              ? 'Vercel Functions'
              : platform === 'edgeone'
                ? 'EdgeOne Functions'
                : platform === 'docker'
                  ? 'Docker Container'
                  : 'Multi-Platform Proxy',
      );
      respHeaders.set('X-Deployment-Platform', platform);

      const statusCode =
        isRangeRequest && (upstream.status === 206 || upstream.headers.get('content-range'))
          ? 206
          : upstream.status;
      const response = new Response(upstream.body, { status: statusCode, headers: respHeaders });

      if (!isRangeRequest && statusCode === 200) {
        ctx.waitUntil(
          (async () => {
            try {
              const cacheResponse = response.clone();
              cacheResponse.headers.set(
                'Cache-Control',
                `public, max-age=${platformConfig.cacheTtl}, s-maxage=${platformConfig.cacheTtl}`,
              );
              cacheResponse.headers.set('X-Cache-TTL', platformConfig.cacheTtl.toString());
              await cache.put(new Request(targetUrl, request), cacheResponse);

              try {
                const preloadHeaders = new Headers(reqHeaders);
                preloadHeaders.set('Range', `bytes=0-${platformConfig.preloadSize - 1}`);
                const preloadResp = await fetch(targetUrl, {
                  headers: preloadHeaders,
                  signal: AbortSignal.timeout(platformConfig.timeout * 0.5),
                });
                if (preloadResp.ok && preloadResp.status === 206) {
                  const preloadCacheKey = new Request(
                    `${targetUrl}?preload=${Math.round(platformConfig.preloadSize / 1024 / 1024)}mb`,
                    request,
                  );
                  const preloadCacheResp = preloadResp.clone();
                  preloadCacheResp.headers.set(
                    'Cache-Control',
                    `public, max-age=${Math.floor(platformConfig.cacheTtl * 0.5)}`,
                  );
                  preloadCacheResp.headers.set(
                    'X-Cache-TTL',
                    Math.floor(platformConfig.cacheTtl * 0.5).toString(),
                  );
                  preloadCacheResp.headers.set(
                    'X-Preload',
                    `${Math.round(platformConfig.preloadSize / 1024 / 1024)}MB`,
                  );
                  await cache.put(preloadCacheKey, preloadCacheResp);
                }
              } catch {}
            } catch {}
          })(),
        );
      }

      return response;
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message || 'audio proxy error' }), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
          'X-Proxy-Platform':
            platform === 'cloudflare-workers'
              ? 'Cloudflare Workers'
              : platform === 'cloudflare-pages'
                ? 'Cloudflare Pages'
                : platform === 'vercel'
                  ? 'Vercel Functions'
                  : platform === 'edgeone'
                    ? 'EdgeOne Functions'
                    : platform === 'docker'
                      ? 'Docker Container'
                      : 'Multi-Platform Proxy',
          'X-Deployment-Platform': platform,
        },
      });
    }
  },
};
