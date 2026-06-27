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

async function ensureWebdavDir({ baseUrl, user, pass }) {
  const url = resolveMusicBase(baseUrl) + '/';
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
    const wUrl = process.env.WEBDAV_URL;
    const wUser = process.env.WEBDAV_USER;
    const wPass = process.env.WEBDAV_PASS;

    if (!wUrl || !wUser || !wPass) {
      return res.status(500).json({
        error: 'WebDAV未配置',
        message: '请设置环境变量 WEBDAV_URL, WEBDAV_USER, WEBDAV_PASS',
      });
    }

    const { fileName, base64, sourceUrl, contentType: reqContentType } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: '缺少 fileName 参数' });
    }

    let fileBuffer;
    let contentType = reqContentType || 'application/octet-stream';

    if (base64) {
      // 从 base64 上传
      fileBuffer = Buffer.from(base64, 'base64');
    } else if (sourceUrl) {
      // 从 URL 下载后上传
      try {
        const downloadRes = await fetch(sourceUrl);
        if (!downloadRes.ok) {
          return res.status(400).json({ error: `下载文件失败: ${downloadRes.status}` });
        }
        const arrayBuffer = await downloadRes.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
        contentType = downloadRes.headers.get('content-type') || contentType;
      } catch (error) {
        return res.status(400).json({ error: `下载文件失败: ${error.message}` });
      }
    } else {
      return res.status(400).json({ error: '需要提供 base64 或 sourceUrl' });
    }

    // 确保 WebDAV 目录存在
    await ensureWebdavDir({ baseUrl: wUrl, user: wUser, pass: wPass });

    // 上传文件到 WebDAV
    const webdavFileUrl =
      resolveMusicBase(wUrl).replace(/\/+$/g, '') + '/' + encodeURIComponent(fileName);
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
      return res.status(putRes.status).json({
        error: `WebDAV 上传失败: ${putRes.status}`,
        details: errorText,
      });
    }

    // 生成访问 URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers.host || req.get?.('host') || '';
    const pathname = new URL(webdavFileUrl).pathname;
    const rawUrl = `${protocol}://${host}/api/webdav/stream?path=${encodeURIComponent(pathname)}`;

    res.json({
      ok: true,
      rawUrl: rawUrl,
      fileName: fileName,
    });
  } catch (error) {
    console.error('WebDAV 上传错误:', error);
    res.status(500).json({
      error: 'WebDAV 上传失败',
      details: error.message,
    });
  }
}
