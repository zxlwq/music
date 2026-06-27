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

async function ensureWebdavDir({ baseUrl, user, pass, env }) {
  const url = resolveMusicBase(baseUrl, env) + '/';
  const res = await fetch(url, {
    method: 'MKCOL',
    headers: {
      Authorization: buildBasicAuth(user, pass),
      'Content-Length': '0',
    },
  });

  if (
    !(
      res.status === 201 ||
      res.status === 405 ||
      res.status === 409 ||
      res.status === 301 ||
      res.status === 302
    )
  ) {
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      // 忽略已存在的目录错误
      if (res.status !== 404) {
        console.warn(`WebDAV MKCOL warning: ${res.status} ${errorText}`);
      }
    }
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }

  return (async () => {
    try {
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
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          },
        );
      }

      const body = await request.json();
      const { fileName, base64, sourceUrl, contentType: reqContentType } = body;

      if (!fileName) {
        return new Response(JSON.stringify({ error: '缺少 fileName 参数' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      let fileBuffer;
      let contentType = reqContentType || 'application/octet-stream';

      if (base64) {
        // 从 base64 上传
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileBuffer = bytes;
      } else if (sourceUrl) {
        // 从 URL 下载后上传
        try {
          const downloadRes = await fetch(sourceUrl);
          if (!downloadRes.ok) {
            return new Response(JSON.stringify({ error: `下载文件失败: ${downloadRes.status}` }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            });
          }
          const arrayBuffer = await downloadRes.arrayBuffer();
          fileBuffer = new Uint8Array(arrayBuffer);
          contentType = downloadRes.headers.get('content-type') || contentType;
        } catch (error) {
          return new Response(JSON.stringify({ error: `下载文件失败: ${error.message}` }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          });
        }
      } else {
        return new Response(JSON.stringify({ error: '需要提供 base64 或 sourceUrl' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      // 确保 WebDAV 目录存在
      await ensureWebdavDir({ baseUrl: wUrl, user: wUser, pass: wPass, env });

      // 上传文件到 WebDAV
      const webdavFileUrl =
        resolveMusicBase(wUrl, env).replace(/\/+$/g, '') + '/' + encodeURIComponent(fileName);
      const putRes = await fetch(webdavFileUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          Authorization: buildBasicAuth(wUser, wPass),
          Overwrite: 'T',
        },
        body: fileBuffer,
      });

      if (!putRes.ok) {
        const errorText = await putRes.text().catch(() => '');
        return new Response(
          JSON.stringify({
            error: `WebDAV 上传失败: ${putRes.status}`,
            details: errorText,
          }),
          {
            status: putRes.status,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          },
        );
      }

      // 生成访问 URL
      const urlObj = new URL(request.url);
      const protocol = urlObj.protocol;
      const host = urlObj.host;
      const pathname = new URL(webdavFileUrl).pathname;
      const rawUrl = `${protocol}//${host}/api/webdav/stream?path=${encodeURIComponent(pathname)}`;

      return new Response(
        JSON.stringify({
          ok: true,
          rawUrl: rawUrl,
          fileName: fileName,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        },
      );
    } catch (error) {
      console.error('WebDAV 上传错误:', error);
      return new Response(
        JSON.stringify({
          error: 'WebDAV 上传失败',
          details: error.message,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        },
      );
    }
  })();
}
