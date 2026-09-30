import multer from 'multer';

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const parseMultipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_REQUEST_BYTES, fields: 10, files: 1 },
}).single('file');

export const config = {
  api: { bodyParser: false },
};

function parseMultipartRequest(req, res) {
  return new Promise((resolve, reject) => {
    parseMultipart(req, res, (error) => (error ? reject(error) : resolve()));
  });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      const error = new Error('Request body exceeds the 4 MB limit');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON request body');
    error.statusCode = 400;
    throw error;
  }
}

function arrayBufferToBase64(buf) {
  try {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  } catch {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
}

function createProxyFetch(proxyUrl, builtinProxyUrl) {
  if (!proxyUrl && !builtinProxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[upload] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[upload] Direct request error: ${error.message}, trying proxy...`);
      }

      if (builtinProxyUrl) {
        try {
          const targetUrl = encodeURIComponent(url);
          const builtinProxiedUrl = `${builtinProxyUrl}?url=${targetUrl}`;

          const builtinOptions = {
            ...options,
            headers: {
              ...options.headers,
              'X-Target-URL': url,
              'X-Proxy-Type': 'github-upload',
            },
          };

          console.log(`[upload] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          console.log(`[upload] Builtin proxy failed: ${error.message}`);
        }
      }

      if (proxyUrl) {
        const targetUrl = encodeURIComponent(url);
        const proxiedUrl = `${proxyUrl}?target=${targetUrl}`;

        const proxyOptions = {
          ...options,
          headers: {
            ...options.headers,
            'X-Target-URL': url,
            'X-Proxy-Type': 'github-upload',
          },
        };

        console.log(`[upload] Using custom proxy: ${proxiedUrl}`);
        return fetch(proxiedUrl, proxyOptions);
      }
    }

    return fetch(url, options);
  };
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
    const ct = req.headers['content-type'] || '';
    let fileName = '';
    let base64 = '';
    let sourceUrl = '';

    const proxyUrl = process.env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

    if (/multipart\/form-data/i.test(ct)) {
      await parseMultipartRequest(req, res);
      const file = req.file;
      fileName = String(req.body?.fileName || '').trim();

      if (!fileName && file?.originalname) fileName = file.originalname;
      if (!fileName) {
        return res.status(400).json({ error: 'Missing fileName' });
      }

      if (file?.buffer) {
        base64 = arrayBufferToBase64(file.buffer);
      } else {
        return res.status(400).json({ error: 'Missing file data' });
      }
    } else {
      const body = await readJsonBody(req);
      fileName = body?.fileName || '';
      base64 = body?.base64 || '';
      sourceUrl = body?.sourceUrl || '';
      if (!fileName) {
        return res.status(400).json({ error: 'Missing fileName' });
      }
    }

    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';

    if (!repoFull || !token) {
      return res.status(500).json({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' });
    }

    const [owner, repo] = String(repoFull).split('/');
    const encodedName = encodeURIComponent(fileName);
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}?ref=${encodeURIComponent(branch)}`;
    const meta = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (Vercel Function)',
      },
    });

    if (meta.status === 200) {
      return res.status(409).json({ error: 'File already exists', exists: true });
    }

    let contentB64 = base64;
    if (!contentB64) {
      if (!sourceUrl) {
        return res.status(400).json({ error: 'Missing base64 or sourceUrl' });
      }
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 30000);
        const upstream = await proxyFetch(sourceUrl, {
          redirect: 'follow',
          signal: ac.signal,
          headers: {
            'User-Agent': 'web-music-player/0.1',
            Accept: 'application/octet-stream',
          },
        });
        clearTimeout(t);
        if (!upstream.ok) {
          const text = await upstream.text().catch(() => '');
          return res
            .status(502)
            .json({ error: `Fetch source failed: ${upstream.status} ${text || ''}`.trim() });
        }
        const buf = await upstream.arrayBuffer();
        contentB64 = arrayBufferToBase64(buf);
      } catch (e) {
        return res.status(502).json({ error: e.message || 'Fetch source error' });
      }
    }

    const api = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}`;
    const putRes = await proxyFetch(api, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'web-music-player/0.1 (Vercel Function)',
      },
      body: JSON.stringify({
        message: `Add music: ${fileName}`,
        content: contentB64,
        branch,
      }),
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return res.status(putRes.status).json({ error: t });
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/public/music/${encodedName}`;
    res.status(200).json({ ok: true, rawUrl });
  } catch (e) {
    console.error('Upload error:', e);
    const status = e.statusCode || (e.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    res.status(status).json({ error: e.message || 'upload error' });
  }
}
