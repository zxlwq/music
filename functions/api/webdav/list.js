import { filenameToDisplayTitle } from '../../../lib/title.js';

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

function resolveMusicBase(base, env) {
  const webdavPath = env?.WEBDAV_PATH || 'music';
  const b = String(base || '').replace(/\/+$/g, '');
  return `${b}/${webdavPath}`;
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
    const wUrl = env.WEBDAV_URL;
    const wUser = env.WEBDAV_USER;
    const wPass = env.WEBDAV_PASS;

    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'cache-control': 'no-store',
    };

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
            ...corsHeaders,
          },
        },
      );
    }

    const url = resolveMusicBase(wUrl, env).replace(/\/+$/g, '') + '/';

    try {
      const response = await fetchWebdavWithProxy(
        url,
        {
          method: 'PROPFIND',
          headers: {
            Depth: '1',
            Authorization: buildBasicAuth(wUser, wPass),
            'Content-Type': 'application/xml',
          },
        },
        env,
      );

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

        return new Response(
          JSON.stringify({
            error: errorDetails,
            details: await response.text().catch(() => ''),
          }),
          {
            status: status,
            headers: {
              'content-type': 'application/json',
              ...corsHeaders,
            },
          },
        );
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
            const urlObj = new URL(request.url);
            const protocol = urlObj.protocol;
            const host = urlObj.host;
            const fileUrl = `${protocol}//${host}/api/webdav/stream?path=${encodeURIComponent(pathname)}`;

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

      return new Response(
        JSON.stringify({
          total: audioFiles.length,
          data: audioFiles,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        },
      );
    } catch (error) {
      console.error('WebDAV PROPFIND 错误:', error);
      throw error;
    }
  } catch (error) {
    console.error('WebDAV 歌单获取错误:', error);
    return new Response(
      JSON.stringify({
        error: '获取WebDAV歌单失败',
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
