import { filenameToDisplayTitle } from '../../lib/title.js';

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];
const isAudio = (name) =>
  AUDIO_EXTS.some((ext) =>
    String(name || '')
      .toLowerCase()
      .endsWith(ext),
  );

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

function resolveMusicBase(base) {
  const webdavPath = process.env.WEBDAV_PATH || 'music';
  const b = String(base || '').replace(/\/+$/g, '');
  return `${b}/${webdavPath}`;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const wUrl = process.env.WEBDAV_URL;
    const wUser = process.env.WEBDAV_USER;
    const wPass = process.env.WEBDAV_PASS;

    if (!wUrl || !wUser || !wPass) {
      // In local/dev environments WebDAV may be intentionally unconfigured.
      // Return an empty result (200) to avoid noisy 500s in the browser console.
      return res.status(200).json({ total: 0, data: [] });
    }

    const url = resolveMusicBase(wUrl).replace(/\/+$/g, '') + '/';

    try {
      const response = await fetchWebdavWithProxy(url, {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          Authorization: buildBasicAuth(wUser, wPass),
          'Content-Type': 'application/xml',
        },
      });

      if (!response.ok) {
        const status = response.status;
        let errorDetails = `WebDAV 错误: ${status}`;

        if (status === 401) {
          errorDetails = 'WebDAV 认证失败，请检查用户名和密码';
        } else if (status === 403) {
          errorDetails = 'WebDAV 访问被拒绝';
        } else if (status === 404) {
          errorDetails = 'WebDAV 路径不存在';
        }

        return res.status(status).json({
          error: errorDetails,
          details: await response.text().catch(() => ''),
        });
      }

      const text = await response.text();
      const hrefs = [];
      const hrefRegex = /<\s*[^:>]*:?href\s*>\s*([^<]+)\s*<\s*\/\s*[^:>]*:?href\s*>/gi;
      let match;
      while ((match = hrefRegex.exec(text)) !== null) {
        hrefs.push(match[1]);
      }

      const audioFiles = [];
      const base = new URL(url);
      const basePathname = base.pathname.replace(/\/+$/g, '') || '/';

      for (const href of hrefs) {
        try {
          const u = new URL(href, base);
          let pathname = decodeURIComponent(u.pathname);
          pathname = pathname.replace(/\/+$/g, '');

          if (!pathname || pathname === basePathname || pathname === basePathname + '/') {
            continue;
          }

          if (!pathname.startsWith(basePathname)) {
            continue;
          }

          const relativePath = pathname.substring(basePathname.length);
          const segs = relativePath.split('/').filter(Boolean);
          const filename = segs.pop() || '';

          if (!filename) {
            continue;
          }

          if (isAudio(filename)) {
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
            const host = req.headers.host || req.get?.('host') || '';
            const fileUrl = `${protocol}://${host}/api/webdav/stream?path=${encodeURIComponent(pathname)}`;

            audioFiles.push({
              filename,
              title: filenameToDisplayTitle(filename) || filename,
              url: fileUrl,
              size: '0 B',
              extension: filename.split('.').pop()?.toUpperCase() || '',
            });
          }
        } catch {
          continue;
        }
      }

      res.json({
        total: audioFiles.length,
        data: audioFiles,
      });
    } catch (error) {
      console.error('WebDAV PROPFIND 错误:', error);
      throw error;
    }
  } catch (error) {
    console.error('WebDAV 歌单获取错误:', error);
    res.status(500).json({
      error: '获取WebDAV歌单失败',
      details: error.message,
    });
  }
}
