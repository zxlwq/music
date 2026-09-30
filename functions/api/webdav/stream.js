import { parseByteRange } from '../../../lib/range.js';

function buildBasicAuth(user, pass) {
  try {
    const bytes = new TextEncoder().encode(`${user}:${pass}`);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return 'Basic ' + btoa(binary);
  } catch {
    return 'Basic ' + btoa(`${user}:${pass}`);
  }
}

async function fetchWebdavWithProxy(url, options = {}, env) {
  const proxyUrl = env.GIT_URL;
  if (!proxyUrl) {
    return fetch(url, options);
  }

  try {
    const directResponse = await fetch(url, options);
    if (directResponse.ok) {
      return directResponse;
    }
    console.log(`[webdav] Direct request failed (${directResponse.status}), trying proxy...`);
  } catch (error) {
    console.log(`[webdav] Direct request error: ${error.message}, trying proxy...`);
  }

  const targetUrl = encodeURIComponent(url);
  const proxiedUrl = `${proxyUrl}?url=${targetUrl}`;

  const proxyOptions = {
    ...options,
    headers: {
      ...options.headers,
      'X-Target-URL': url,
      'X-Proxy-Type': 'webdav',
    },
  };

  console.log(`[webdav] Using proxy: ${proxiedUrl}`);
  return fetch(proxiedUrl, proxyOptions);
}

export const onRequestGet = async ({ env, request }) => {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');

    if (!filePath) {
      return new Response(JSON.stringify({ error: '缺少 path 参数' }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      });
    }

    const wUrl = env.WEBDAV_URL;
    const wUser = env.WEBDAV_USER;
    const wPass = env.WEBDAV_PASS;

    if (!wUrl || !wUser || !wPass) {
      return new Response(
        JSON.stringify({
          error: 'WebDAV未配置',
          message: '请设置环境变量 WEBDAV_URL, WEBDAV_USER, WEBDAV_PASS',
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
        },
      );
    }

    const resolveWebdavUrl = (baseUrl, requestedPath) => {
      const webdavBaseUrl = new URL(baseUrl);
      const webdavBasePath = webdavBaseUrl.pathname.replace(/\/+$/g, '') || '/';
      const basePathNoSlash = webdavBasePath === '/' ? '' : webdavBasePath.replace(/^\/+/, '');
      let normalizedRequestPath = requestedPath.replace(/\\/g, '/');

      if (/^https?:\/\//i.test(normalizedRequestPath)) {
        try {
          const parsedUrl = new URL(normalizedRequestPath);
          if (parsedUrl.origin !== webdavBaseUrl.origin) return null;
          normalizedRequestPath = parsedUrl.pathname;
        } catch {
          return null;
        }
      }

      normalizedRequestPath = normalizedRequestPath.replace(/^\/+/, '');
      if (
        basePathNoSlash &&
        (normalizedRequestPath === basePathNoSlash ||
          normalizedRequestPath.startsWith(`${basePathNoSlash}/`))
      ) {
        normalizedRequestPath = normalizedRequestPath
          .slice(basePathNoSlash.length)
          .replace(/^\/+/, '');
      }

      const resolvedSegments =
        webdavBasePath === '/' ? [] : webdavBasePath.split('/').filter(Boolean);
      for (const segment of normalizedRequestPath.split('/').filter(Boolean)) {
        if (segment === '.' || segment === '') continue;
        if (segment === '..') {
          if (resolvedSegments.length === 0) return null;
          resolvedSegments.pop();
          continue;
        }
        resolvedSegments.push(segment);
      }

      const finalPath = `/${resolvedSegments.join('/')}`;
      if (!finalPath.startsWith(webdavBasePath)) return null;
      return `${webdavBaseUrl.origin}${finalPath}`;
    };

    const webdavUrl = resolveWebdavUrl(wUrl, filePath);
    if (!webdavUrl) {
      return new Response(JSON.stringify({ error: '非法 WebDAV 路径' }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      });
    }

    try {
      let contentLength = null;
      let contentType = 'audio/mpeg';

      try {
        const headResponse = await fetchWebdavWithProxy(
          webdavUrl,
          {
            method: 'HEAD',
            headers: {
              Authorization: buildBasicAuth(wUser, wPass),
            },
          },
          env,
        );

        if (headResponse.ok) {
          const lengthHeader = headResponse.headers.get('content-length');
          const parsedLength = lengthHeader ? Number(lengthHeader) : NaN;
          if (Number.isSafeInteger(parsedLength) && parsedLength >= 0) {
            contentLength = parsedLength;
          }
          contentType = headResponse.headers.get('content-type') || 'audio/mpeg';
        }
      } catch (headError) {
        console.log('WebDAV HEAD 请求失败，将使用 GET 请求:', headError.message);
      }

      const fileNameLower = filePath.toLowerCase();
      if (fileNameLower.endsWith('.mp3')) contentType = 'audio/mpeg';
      else if (fileNameLower.endsWith('.wav')) contentType = 'audio/wav';
      else if (fileNameLower.endsWith('.flac')) contentType = 'audio/flac';
      else if (fileNameLower.endsWith('.aac')) contentType = 'audio/aac';
      else if (fileNameLower.endsWith('.m4a')) contentType = 'audio/mp4';
      else if (fileNameLower.endsWith('.ogg')) contentType = 'audio/ogg';
      else if (fileNameLower.endsWith('.opus')) contentType = 'audio/opus';
      else if (fileNameLower.endsWith('.webm')) contentType = 'audio/webm';

      const rangeHeader = request.headers.get('range');
      const range = contentLength === null ? null : parseByteRange(rangeHeader, contentLength);
      if (range?.unsatisfiable) {
        return new Response(null, {
          status: 416,
          headers: {
            'content-range': `bytes */${contentLength}`,
            'accept-ranges': 'bytes',
            'access-control-allow-origin': '*',
          },
        });
      }

      const getHeaders = {
        Authorization: buildBasicAuth(wUser, wPass),
      };
      if (range) {
        getHeaders.Range = `bytes=${range.start}-${range.end}`;
      } else if (rangeHeader && contentLength === null) {
        getHeaders.Range = rangeHeader;
      }

      const getResponse = await fetchWebdavWithProxy(
        webdavUrl,
        {
          method: 'GET',
          headers: getHeaders,
        },
        env,
      );

      if (getResponse.status === 416) {
        const headers = {
          'accept-ranges': 'bytes',
          'access-control-allow-origin': '*',
        };
        const upstreamContentRange = getResponse.headers.get('content-range');
        if (upstreamContentRange) headers['content-range'] = upstreamContentRange;
        else if (contentLength !== null) headers['content-range'] = `bytes */${contentLength}`;
        return new Response(null, { status: 416, headers });
      }

      if (!getResponse.ok) {
        return new Response(JSON.stringify({ error: '获取文件失败' }), {
          status: getResponse.status,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
        });
      }

      const buffer = await getResponse.arrayBuffer();
      const isPartial = getResponse.status === 206;
      let contentRange = getResponse.headers.get('content-range');
      if (!contentRange && isPartial && range && buffer.byteLength === range.length) {
        contentRange = `bytes ${range.start}-${range.end}/${range.total}`;
      }
      if (isPartial && !contentRange) {
        return new Response(JSON.stringify({ error: 'WebDAV 返回了不完整的 206 响应' }), {
          status: 502,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
        });
      }

      return new Response(buffer, {
        status: isPartial ? 206 : 200,
        headers: {
          'content-type': contentType,
          'content-length': buffer.byteLength.toString(),
          'accept-ranges': 'bytes',
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=31536000, immutable',
          ...(isPartial ? { 'content-range': contentRange } : {}),
        },
      });
    } catch (error) {
      console.error('WebDAV 文件获取错误:', error);
      return new Response(
        JSON.stringify({
          error: '获取文件失败',
          details: error.message,
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
        },
      );
    }
  } catch (error) {
    console.error('WebDAV 流式传输错误:', error);
    return new Response(
      JSON.stringify({
        error: 'WebDAV 流式传输失败',
        details: error.message,
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      },
    );
  }
};
