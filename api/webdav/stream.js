import { parseByteRange } from '../../lib/range.js';

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

async function fetchWebdavWithProxy(url, options = {}) {
  const proxyUrl = process.env.GIT_URL;
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: '缺少 path 参数' });
    }

    const wUrl = process.env.WEBDAV_URL;
    const wUser = process.env.WEBDAV_USER;
    const wPass = process.env.WEBDAV_PASS;

    if (!wUrl || !wUser || !wPass) {
      return res.status(500).json({
        error: 'WebDAV未配置',
        message: '请设置环境变量 WEBDAV_URL, WEBDAV_USER, WEBDAV_PASS',
      });
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
      return res.status(400).json({ error: '非法 WebDAV 路径' });
    }

    try {
      let contentLength = null;
      let contentType = 'audio/mpeg';

      try {
        const headResponse = await fetchWebdavWithProxy(webdavUrl, {
          method: 'HEAD',
          headers: {
            Authorization: buildBasicAuth(wUser, wPass),
          },
        });

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

      const rangeHeader = req.headers.range;
      const range = contentLength === null ? null : parseByteRange(rangeHeader, contentLength);
      if (range?.unsatisfiable) {
        res.setHeader('Content-Range', `bytes */${contentLength}`);
        res.setHeader('Accept-Ranges', 'bytes');
        return res.status(416).end();
      }

      const getHeaders = {
        Authorization: buildBasicAuth(wUser, wPass),
      };
      if (range) {
        getHeaders.Range = `bytes=${range.start}-${range.end}`;
      } else if (rangeHeader && contentLength === null) {
        getHeaders.Range = rangeHeader;
      }

      const getResponse = await fetchWebdavWithProxy(webdavUrl, {
        method: 'GET',
        headers: getHeaders,
      });

      if (getResponse.status === 416) {
        const upstreamContentRange = getResponse.headers.get('content-range');
        if (upstreamContentRange) res.setHeader('Content-Range', upstreamContentRange);
        else if (contentLength !== null) res.setHeader('Content-Range', `bytes */${contentLength}`);
        res.setHeader('Accept-Ranges', 'bytes');
        return res.status(416).end();
      }

      if (!getResponse.ok) {
        return res.status(getResponse.status).json({ error: '获取文件失败' });
      }

      const buffer = await getResponse.arrayBuffer();
      const bufferData = Buffer.from(buffer);
      const isPartial = getResponse.status === 206;
      let contentRange = getResponse.headers.get('content-range');
      if (!contentRange && isPartial && range && bufferData.length === range.length) {
        contentRange = `bytes ${range.start}-${range.end}/${range.total}`;
      }
      if (isPartial && !contentRange) {
        return res.status(502).json({ error: 'WebDAV 返回了不完整的 206 响应' });
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', bufferData.length);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (isPartial) res.setHeader('Content-Range', contentRange);

      return res.status(isPartial ? 206 : 200).send(bufferData);
    } catch (error) {
      console.error('WebDAV 文件获取错误:', error);
      return res.status(500).json({
        error: '获取文件失败',
        details: error.message,
      });
    }
  } catch (error) {
    console.error('WebDAV 流式传输错误:', error);
    res.status(500).json({
      error: 'WebDAV 流式传输失败',
      details: error.message,
    });
  }
}
