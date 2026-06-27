import express from 'express';
import compression from 'compression';
import multer from 'multer';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { runUserDataSync } from './lib/sync.js';
import { filenameToDisplayTitle } from './lib/title.js';
import { loadEnvFile } from './lib/load-env.js';

const loadedEnvFile = loadEnvFile();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  );

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

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

function createProxyFetch(proxyUrl) {
  if (!proxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`Direct request error: ${error.message}, trying proxy...`);
      }

      const targetUrl = encodeURIComponent(url);
      const proxiedUrl = `${proxyUrl}?target=${targetUrl}`;

      const proxyOptions = {
        ...options,
        headers: {
          ...options.headers,
          'X-Target-URL': url,
          'X-Proxy-Type': 'github-api',
        },
      };

      console.log(`Using proxy: ${proxiedUrl}`);
      return fetch(proxiedUrl, proxyOptions);
    }

    return fetch(url, options);
  };
}

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];
const isAudio = (name) =>
  AUDIO_EXTS.some((ext) =>
    String(name || '')
      .toLowerCase()
      .endsWith(ext),
  );

const R2_BUCKET_NAME = 'music';

// 生成 R2 预签名 PUT URL（S3 SigV4）
function createPresignedPutUrl({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
  contentType = 'application/octet-stream',
  expires = 900,
}) {
  const method = 'PUT';
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const query = new URLSearchParams({
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalUri = `/${bucket}/${encodeURIComponent(key)}`;
  const canonicalQuerystring = query.toString();
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalRequestHash = crypto
    .createHash('sha256')
    .update(canonicalRequest, 'utf8')
    .digest('hex');

  const stringToSign = [algorithm, amzDate, credentialScope, canonicalRequestHash].join('\n');

  const kDate = crypto
    .createHmac('sha256', 'AWS4' + secretAccessKey)
    .update(dateStamp)
    .digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  query.set('X-Amz-Signature', signature);

  const uploadUrl = `${endpoint}${canonicalUri}?${query.toString()}`;
  return { uploadUrl, key, expires, contentType, headers: {} };
}

function getR2Client() {
  const accountId = process.env.ACCOUNT_ID;
  const accessKeyId = process.env.ACCESS_KEY_ID;
  const secretAccessKey = process.env.SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

app.get('/api/music/list', async (req, res) => {
  try {
    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';
    const proxyUrl = process.env.GIT_URL;
    const proxyFetch = createProxyFetch(proxyUrl);

    if (!repoFull) {
      return res.status(500).json({
        error: '未配置 GIT_REPO 环境变量',
        details: '请在环境变量中设置 GIT_REPO',
      });
    }

    if (!token) {
      return res.status(500).json({
        error: '未配置 GIT_TOKEN 环境变量',
        details: '请在环境变量中设置 GIT_TOKEN',
      });
    }

    const [owner, repo] = String(repoFull).split('/');

    if (!owner || !repo) {
      return res.status(400).json({
        error: 'GIT_REPO 格式无效',
        details: 'GIT_REPO 应为 "owner/repo" 格式',
        provided: repoFull,
      });
    }

    const api = `https://api.github.com/repos/${owner}/${repo}/contents/public/music?ref=${encodeURIComponent(branch)}`;
    const gh = await proxyFetch(api, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'music',
      },
    });

    if (!gh.ok) {
      const errorText = await gh.text();
      let errorDetails = `GitHub API 错误: ${gh.status}`;

      if (gh.status === 401) {
        errorDetails = 'GitHub Token 无效或已过期';
      } else if (gh.status === 403) {
        errorDetails = 'GitHub Token 缺少仓库访问权限';
      } else if (gh.status === 404) {
        errorDetails = '仓库不存在或 public/music 目录不存在';
      }

      return res.status(gh.status).json({
        error: errorDetails,
        status: gh.status,
        details: errorText,
        api_url: api,
      });
    }

    const items = await gh.json();
    const files = (Array.isArray(items) ? items : []).filter(
      (it) => it && it.type === 'file' && isAudio(it.name),
    );
    const tracks = files.map((f) => ({
      title: filenameToDisplayTitle(f.name || '') || f.name,
      url:
        f.download_url ||
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/public/music/${encodeURIComponent(f.name)}`,
    }));

    res.json({ ok: true, tracks });
  } catch (e) {
    console.error('Music list error:', e);
    res.status(500).json({ error: e.message || '获取歌单失败' });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const ct = req.headers['content-type'] || '';
    let fileName = '';
    let base64 = '';
    let sourceUrl = '';

    const proxyUrl = process.env.GIT_URL;
    const proxyFetch = createProxyFetch(proxyUrl);

    if (/multipart\/form-data/i.test(ct)) {
      fileName = String(req.body.fileName || '').trim();
      const file = req.file;
      if (!fileName && file && file.originalname) fileName = file.originalname;
      if (!fileName) {
        return res.status(400).json({ error: '缺少文件名' });
      }
      if (file && file.buffer) {
        base64 = arrayBufferToBase64(file.buffer);
      } else {
        return res.status(400).json({ error: '缺少文件数据' });
      }
    } else {
      const body = req.body;
      fileName = body?.fileName || '';
      base64 = body?.base64 || '';
      sourceUrl = body?.sourceUrl || '';
      if (!fileName) {
        return res.status(400).json({ error: '缺少文件名' });
      }
    }

    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';

    if (!repoFull || !token) {
      return res.status(500).json({ error: '服务器未配置: 缺少 GIT_REPO/GIT_TOKEN' });
    }

    const [owner, repo] = String(repoFull).split('/');
    const encodedName = encodeURIComponent(fileName);
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}?ref=${encodeURIComponent(branch)}`;
    const meta = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'music',
      },
    });

    if (meta.status === 200) {
      return res.status(409).json({ error: '文件已存在', exists: true });
    }

    let contentB64 = base64;
    if (!contentB64) {
      if (!sourceUrl) {
        return res.status(400).json({ error: '缺少 base64 或 sourceUrl' });
      }
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 30000);
        const upstream = await proxyFetch(sourceUrl, {
          redirect: 'follow',
          signal: ac.signal,
          headers: {
            'User-Agent': 'music',
            Accept: 'application/octet-stream',
          },
        });
        clearTimeout(t);
        if (!upstream.ok) {
          const text = await upstream.text().catch(() => '');
          return res
            .status(502)
            .json({ error: `获取源文件失败: ${upstream.status} ${text || ''}`.trim() });
        }
        const buf = await upstream.arrayBuffer();
        contentB64 = arrayBufferToBase64(buf);
      } catch (e) {
        return res.status(502).json({ error: e.message || '获取源文件错误' });
      }
    }

    const api = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}`;
    const putRes = await proxyFetch(api, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'music',
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
    res.json({ ok: true, rawUrl });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message || '上传失败' });
  }
});

app.post('/api/delete', async (req, res) => {
  try {
    const { filePath, rawUrl, password } = req.body;
    const expectedPassword = String(process.env.PASSWORD ?? '').trim();

    if (!expectedPassword) {
      return res.status(503).json({
        error: '删除功能已禁用：请在环境变量中设置非空 PASSWORD',
        code: 'PASSWORD_NOT_CONFIGURED',
      });
    }
    if (String(password || '') !== expectedPassword) {
      return res.status(401).json({
        error: 'Unauthorized',
        code: 'INVALID_PASSWORD',
      });
    }

    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';
    const proxyUrl = process.env.GIT_URL;
    const proxyFetch = createProxyFetch(proxyUrl);

    if (!repoFull || !token) {
      return res.status(500).json({ error: '服务器未配置: 缺少 GIT_REPO/GIT_TOKEN' });
    }

    let pathInRepo = String(filePath || '').replace(/^\/+/, '');
    if (!pathInRepo && rawUrl) {
      try {
        const u = new URL(rawUrl);
        if (u.hostname === 'raw.githubusercontent.com') {
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 4) {
            const rest = parts.slice(3).join('/');
            pathInRepo = decodeURIComponent(rest);
          }
        }
      } catch {}
    }

    if (!pathInRepo) {
      return res.status(400).json({ error: '缺少 filePath 或 rawUrl' });
    }

    if (!/^public\/music\//.test(pathInRepo)) {
      return res.status(400).json({ error: '拒绝删除 public/music 目录外的文件' });
    }

    const [owner, repo] = String(repoFull).split('/');
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;

    const metaRes = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'music',
      },
    });

    if (metaRes.status === 404) {
      return res.json({ ok: true, skipped: true, message: '文件不存在' });
    }

    if (!metaRes.ok) {
      const t = await metaRes.text();
      return res
        .status(metaRes.status)
        .json({ error: `获取文件元数据失败: ${metaRes.status} ${t}` });
    }

    const meta = await metaRes.json();
    const sha = meta.sha;
    if (!sha) {
      return res.status(500).json({ error: '未找到文件 SHA' });
    }

    const delApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}`;
    const body = {
      message: `Delete music: ${pathInRepo}`,
      sha,
      branch,
    };

    const delRes = await proxyFetch(delApi, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'music',
      },
      body: JSON.stringify(body),
    });

    if (!delRes.ok) {
      const t = await delRes.text();
      return res.status(delRes.status).json({ error: `删除失败: ${delRes.status} ${t}` });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

app.get('/api/audio', async (req, res) => {
  try {
    let target = req.query.url;
    if (Array.isArray(target)) {
      target = target[0];
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
      return res.status(400).json({ error: '缺少 url 参数' });
    }

    try {
      validateTargetUrl(target);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const incomingRange = req.headers.range;
    const isRangeRequest = !!incomingRange;

    const reqHeaders = new Headers();

    const userAgent = req.headers['user-agent'] || '';
    const isMobileChrome = /Android.*Chrome/i.test(userAgent);

    if (isMobileChrome) {
      reqHeaders.set(
        'User-Agent',
        'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
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
        lastError = new Error(`上游服务器错误: ${upstream.status}`);
      } catch (e) {
        lastError = e;
        console.warn(`Audio proxy attempt ${i + 1} failed:`, e.message);
      }
      if (i < maxRetries) {
        const retryDelay = isMobileChrome ? 500 : 100;
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }

    if (!upstream || !upstream.body || upstream.status >= 400) {
      const status = upstream ? upstream.status : 502;
      const msg = lastError?.message || `上游服务器错误: ${status}`;
      return res.status(status).json({ error: msg });
    }

    const respHeaders = {};
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
          return res.status(415).json({
            error: `Unsupported upstream content type: ${trimmedType || 'unknown'}`,
          });
        }
        ct = inferred;
      } else {
        return res.status(415).json({ error: `Unsupported upstream content type: ${trimmedType}` });
      }
    }

    respHeaders['Content-Type'] = ct;
    if (cl) respHeaders['Content-Length'] = cl;
    if (cr) respHeaders['Content-Range'] = cr;
    respHeaders['Accept-Ranges'] = ar;
    respHeaders['Cache-Control'] = 'public, max-age=7200, must-revalidate';
    respHeaders['Access-Control-Allow-Origin'] = '*';
    respHeaders['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges';
    respHeaders['X-Content-Type-Options'] = 'nosniff';

    const isPartial = !!incomingRange && (cr || upstream.status === 206);
    const statusCode = isPartial ? 206 : upstream.status || 200;

    res.status(statusCode);
    Object.entries(respHeaders).forEach(([key, value]) => {
      res.set(key, value);
    });

    const reader = upstream.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (error) {
        console.error('Stream error:', error);
        res.end();
      }
    };

    pump();
  } catch (e) {
    console.error('Audio proxy error:', e);
    res.status(500).json({ error: e.message || '音频代理错误' });
  }
});

app.post('/api/exists', async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'Missing fileName' });
    }

    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';
    const proxyUrl = process.env.GIT_URL;
    const proxyFetch = createProxyFetch(proxyUrl);

    if (!repoFull || !token) {
      return res.status(500).json({ error: '服务器未配置: 缺少 GIT_REPO/GIT_TOKEN' });
    }

    const [owner, repo] = String(repoFull).split('/');
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/public/music/${encodeURIComponent(fileName)}`;
    let exists;

    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2000);
      const head = await proxyFetch(rawUrl, { method: 'HEAD', signal: ac.signal });
      clearTimeout(t);
      if (head.status === 200) exists = true;
      else if (head.status === 404) exists = false;
    } catch {}

    if (exists === undefined) {
      const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodeURIComponent(fileName)}?ref=${encodeURIComponent(branch)}`;
      const meta = await proxyFetch(metaApi, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'music',
        },
      });
      exists = meta.status === 200;
    }

    res.json({ ok: true, exists });
  } catch (e) {
    console.error('Exists check error:', e);
    res.status(500).json({ error: e.message || '文件存在性检查失败' });
  }
});

app.post('/api/fetch', async (req, res) => {
  try {
    const body = req.body;

    if (body.action === 'getConfig') {
      const customProxyUrl = process.env.GIT_URL || '';
      const config = {
        customProxyUrl: customProxyUrl,
        hasCustomProxy: !!customProxyUrl,
      };

      return res.json(config);
    }

    if (body.action === 'customProxy') {
      const { url } = body;
      const customProxyUrl = process.env.GIT_URL || '';

      if (!customProxyUrl) {
        return res.status(400).json({ error: '未配置自定义代理' });
      }

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: '缺少 url' });
      }

      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: '仅允许 http/https 协议' });
      }

      try {
        const proxyUrl = `${customProxyUrl}?url=${encodeURIComponent(url)}`;
        console.log('[api/fetch] Custom proxy request:', { proxyUrl });
        const headers = {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept:
            'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/m4a,audio/webm,audio/*,*/*;q=0.9',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const upstream = await fetch(proxyUrl, {
          redirect: 'follow',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        console.log('[api/fetch] Custom proxy upstream status:', upstream.status);
        if (!upstream.ok) {
          return res
            .status(upstream.status)
            .json({ error: `自定义代理上游服务器错误: ${upstream.status}` });
        }
        const arrayBuf = await upstream.arrayBuffer();
        const fileSize = arrayBuf.byteLength;
        const isLargeFile = fileSize > 5 * 1024 * 1024;

        const toBase64 = async (buffer) => {
          const bytes = new Uint8Array(buffer);
          const chunkSize = isLargeFile ? 0x4000 : 0x8000;
          let binary = '';
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const sub = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, sub);
            if (isLargeFile && i % (chunkSize * 10) === 0) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          return btoa(binary);
        };
        const base64 = await toBase64(arrayBuf);
        const mime = upstream.headers.get('content-type') || 'application/octet-stream';
        const resp = { base64, contentType: mime };
        console.log('[api/fetch] Custom proxy success:', {
          bytes: arrayBuf.byteLength,
          contentType: mime,
        });
        return res.json(resp);
      } catch (error) {
        console.error('[api/fetch] Custom proxy error:', error);
        return res.status(500).json({ error: `自定义代理错误: ${error.message}` });
      }
    }

    const { url } = body;
    console.log('[api/fetch] POST invoked', { url });
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url' });
    }
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Only http/https allowed' });
    }

    const headers = {};
    try {
      const u = new URL(url);
      headers['Referer'] = `${u.origin}/`;
    } catch {}
    headers['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

    const upstream = await fetch(url, { redirect: 'follow', headers });
    console.log('[api/fetch] upstream status', upstream.status);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `上游服务器错误: ${upstream.status}` });
    }

    const arrayBuf = await upstream.arrayBuffer();
    const toBase64 = (buffer) => {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const sub = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, sub);
      }
      return btoa(binary);
    };
    const base64 = toBase64(arrayBuf);
    const mime = upstream.headers.get('content-type') || 'application/octet-stream';
    const resp = { base64, contentType: mime };
    console.log('[api/fetch] success', { bytes: arrayBuf.byteLength, contentType: mime });
    return res.json(resp);
  } catch (e) {
    console.error('[api/fetch] error', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: e.message || '代理错误' });
  }
});

app.post('/api/gist', async (req, res) => {
  try {
    const { status, body } = await runUserDataSync(req.body, process.env, {
      userAgent: 'music',
    });
    res.status(status).json(body);
  } catch (e) {
    console.error('Gist error:', e);
    res.status(500).json({ error: e.message || 'Gist 操作失败' });
  }
});

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

app.get('/api/webdav/list', async (req, res) => {
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
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.get('host');
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
});

app.get('/api/webdav/stream', async (req, res) => {
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
      let contentLength = 0;
      let contentType = 'audio/mpeg';

      try {
        const headResponse = await fetchWebdavWithProxy(webdavUrl, {
          method: 'HEAD',
          headers: {
            Authorization: buildBasicAuth(wUser, wPass),
          },
        });

        if (headResponse.ok) {
          contentLength = parseInt(headResponse.headers.get('content-length') || '0', 10);
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
      if (rangeHeader && contentLength > 0) {
        const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : contentLength - 1;

          const getResponse = await fetchWebdavWithProxy(webdavUrl, {
            method: 'GET',
            headers: {
              Authorization: buildBasicAuth(wUser, wPass),
              Range: `bytes=${start}-${end}`,
            },
          });

          if (!getResponse.ok) {
            return res.status(getResponse.status).json({ error: '获取文件失败' });
          }

          const buffer = await getResponse.arrayBuffer();
          const bufferData = Buffer.from(buffer);

          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${contentLength}`);
          res.setHeader('Content-Length', bufferData.length);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

          return res.status(206).send(bufferData);
        }
      }

      const getResponse = await fetchWebdavWithProxy(webdavUrl, {
        method: 'GET',
        headers: {
          Authorization: buildBasicAuth(wUser, wPass),
        },
      });

      if (!getResponse.ok) {
        return res.status(getResponse.status).json({ error: '获取文件失败' });
      }

      const buffer = await getResponse.arrayBuffer();
      const bufferData = Buffer.from(buffer);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', bufferData.length);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      return res.status(200).send(bufferData);
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
});

app.post('/api/webdav/upload', upload.single('file'), async (req, res) => {
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

    const { fileName, base64, sourceUrl } = req.body;
    const file = req.file;

    if (!fileName) {
      return res.status(400).json({ error: '缺少 fileName 参数' });
    }

    let fileBuffer;
    let contentType = 'application/octet-stream';

    if (file) {
      // 从 FormData 上传的文件
      fileBuffer = file.buffer;
      contentType = file.mimetype || contentType;
    } else if (base64) {
      // 从 base64 上传
      fileBuffer = Buffer.from(base64, 'base64');
      // 尝试从 base64 数据推断 content-type
      if (req.body.contentType) {
        contentType = req.body.contentType;
      }
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
      return res.status(400).json({ error: '需要提供 file、base64 或 sourceUrl 之一' });
    }

    // 确保 WebDAV 目录存在
    const webdavDirUrl = resolveMusicBase(wUrl) + '/';
    try {
      await fetch(webdavDirUrl, {
        method: 'MKCOL',
        headers: {
          Authorization: buildBasicAuth(wUser, wPass),
          'Content-Length': '0',
        },
      });
    } catch {
      // 目录可能已存在，忽略错误
    }

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
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host');
    const rawUrl = `${protocol}://${host}/api/webdav/stream?path=${encodeURIComponent(webdavFileUrl.replace(new URL(wUrl).origin, ''))}`;

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
});

app.post('/api/webdav', async (req, res) => {
  try {
    const { action, cursor, limit } = req.body;
    const repoFull = process.env.GIT_REPO;
    const token = process.env.GIT_TOKEN;
    const branch = process.env.GIT_BRANCH || 'main';
    const wUrl = process.env.WEBDAV_URL;
    const wUser = process.env.WEBDAV_USER;
    const wPass = process.env.WEBDAV_PASS;
    const proxyUrl = process.env.GIT_URL;
    const proxyFetch = createProxyFetch(proxyUrl);

    if (!repoFull || !token) {
      return res.status(500).json({ error: '服务器未配置: 缺少 GIT_REPO/GIT_TOKEN' });
    }
    if (!wUrl || !wUser || !wPass) {
      return res
        .status(500)
        .json({ error: '服务器未配置: 缺少 WEBDAV_URL/WEBDAV_USER/WEBDAV_PASS' });
    }

    function joinUrl(base, name) {
      const b = resolveMusicBase(base).replace(/\/+$/g, '');
      const n = encodeURIComponent(name);
      return `${b}/${n}`;
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
        if (!res.ok) throw new Error(`WebDAV MKCOL failed: ${res.status} ${await res.text()}`);
      }
    }

    async function listGithubMusic({
      repoFull,
      token,
      branch,
      path = 'public/music',
      proxyFetch = fetch,
    }) {
      const [owner, repo] = String(repoFull).split('/');
      const segs = String(path || 'public/music').replace(/^\/+|\/+$/g, '');
      const part = segs ? '/' + segs.split('/').map(encodeURIComponent).join('/') : '';
      const api = `https://api.github.com/repos/${owner}/${repo}/contents${part}?ref=${encodeURIComponent(branch)}`;
      const res = await proxyFetch(api, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'music',
        },
      });
      if (!res.ok) throw new Error(`GitHub list failed: ${res.status} ${await res.text()}`);
      const items = await res.json();
      return (Array.isArray(items) ? items : []).filter(
        (it) => it && it.type === 'file' && isAudio(it.name),
      );
    }

    if (action === 'upload') {
      await ensureWebdavDir({ baseUrl: wUrl, user: wUser, pass: wPass });
      const files = await listGithubMusic({ repoFull, token, branch, proxyFetch });
      if (!files.length) {
        return res.json({ ok: true, total: 0, uploaded: 0, message: 'No audio files in repo' });
      }

      let existingNames = [];
      try {
        const url = resolveMusicBase(wUrl).replace(/\/+$/g, '') + '/';
        const res = await fetch(url, {
          method: 'PROPFIND',
          headers: {
            Depth: '1',
            Authorization: buildBasicAuth(wUser, wPass),
          },
        });
        if (res.ok) {
          const text = await res.text();
          const hrefs = Array.from(
            text.matchAll(/<\s*[^:>]*:?href\s*>\s*([^<]+)\s*<\s*\/\s*[^:>]*:?href\s*>/gi),
          ).map((m) => m[1]);
          try {
            const base = new URL(url);
            for (const h of hrefs) {
              try {
                const u = new URL(h, base);
                const pathname = decodeURIComponent(u.pathname);
                const segs = pathname.split('/').filter(Boolean);
                const last = segs.pop() || '';
                if (last && isAudio(last)) existingNames.push(last);
              } catch {}
            }
          } catch {}
        }
      } catch {}

      const existingSet = new Set(existingNames || []);
      const start = Math.max(0, Number(cursor) || 0);
      const step = Math.max(1, Math.min(Number(limit) || 3, 10));
      const slice = files.slice(start, start + step);
      let done = 0;
      let skipped = 0;
      const errors = [];

      for (const f of slice) {
        const name = f.name;
        try {
          if (existingSet.has(name)) {
            skipped++;
            continue;
          }
          const downloadUrl =
            f.download_url ||
            `https://raw.githubusercontent.com/${repoFull}/${encodeURIComponent(branch)}/public/music/${encodeURIComponent(name)}`;
          const rawRes = await proxyFetch(downloadUrl, {
            headers: {
              'User-Agent': 'music',
              Accept: 'application/octet-stream',
            },
          });
          if (!rawRes.ok) {
            const t = await rawRes.text().catch(() => '');
            throw new Error(`Fetch file failed: ${rawRes.status} ${t}`);
          }
          const buf = new Uint8Array(await rawRes.arrayBuffer());

          const url = joinUrl(wUrl, name);
          const putRes = await fetch(url, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              Authorization: buildBasicAuth(wUser, wPass),
              Overwrite: 'T',
            },
            body: buf,
          });
          if (!putRes.ok)
            throw new Error(`WebDAV PUT failed: ${putRes.status} ${await putRes.text()}`);
          done++;
        } catch (e) {
          errors.push({ file: name, error: e && e.message ? e.message : String(e) });
        }
      }

      const nextCursor = start + step < files.length ? start + step : null;
      const processed = slice.length;
      const status = errors.length === processed ? 500 : errors.length ? 207 : 200;
      res.status(status).json({
        ok: errors.length === 0,
        total: files.length,
        processed,
        uploaded: done,
        skipped,
        nextCursor,
        errors,
      });
    } else if (action === 'restore') {
      await ensureWebdavDir({ baseUrl: wUrl, user: wUser, pass: wPass });
      let webdavFiles = [];
      try {
        const url = resolveMusicBase(wUrl).replace(/\/+$/g, '') + '/';
        const res = await fetch(url, {
          method: 'PROPFIND',
          headers: {
            Depth: '1',
            Authorization: buildBasicAuth(wUser, wPass),
          },
        });
        if (res.ok) {
          const text = await res.text();
          const hrefs = Array.from(
            text.matchAll(/<\s*[^:>]*:?href\s*>\s*([^<]+)\s*<\s*\/\s*[^:>]*:?href\s*>/gi),
          ).map((m) => m[1]);
          try {
            const base = new URL(url);
            for (const h of hrefs) {
              try {
                const u = new URL(h, base);
                const pathname = decodeURIComponent(u.pathname);
                const segs = pathname.split('/').filter(Boolean);
                const last = segs.pop() || '';
                if (last && isAudio(last)) {
                  webdavFiles.push({ name: last, download_url: u.toString() });
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}

      if (!webdavFiles.length) {
        return res.json({ ok: true, total: 0, restored: 0, message: 'No audio files in WebDAV' });
      }
      let existingNames = [];
      try {
        const files = await listGithubMusic({ repoFull, token, branch, proxyFetch });
        existingNames = files.map((f) => f.name);
      } catch {}

      const existingSet = new Set(existingNames || []);
      const start = Math.max(0, Number(cursor) || 0);
      const step = Math.max(1, Math.min(Number(limit) || 3, 10));
      const slice = webdavFiles.slice(start, start + step);
      let done = 0;
      let skipped = 0;
      const errors = [];

      for (const f of slice) {
        const name = f.name;
        try {
          if (existingSet.has(name)) {
            skipped++;
            continue;
          }

          const downloadRes = await fetch(f.download_url, {
            headers: {
              Authorization: buildBasicAuth(wUser, wPass),
              'User-Agent': 'music',
            },
          });
          if (!downloadRes.ok) {
            throw new Error(`WebDAV download failed: ${downloadRes.status}`);
          }
          const buf = new Uint8Array(await downloadRes.arrayBuffer());

          const content = Buffer.from(buf).toString('base64');
          const uploadUrl = `https://api.github.com/repos/${repoFull}/contents/public/music/${encodeURIComponent(name)}`;
          const uploadRes = await proxyFetch(uploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'music',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: `Add ${name} via WebDAV restore`,
              content: content,
              branch: branch,
            }),
          });

          if (!uploadRes.ok) {
            const errorText = await uploadRes.text();
            throw new Error(`GitHub upload failed: ${uploadRes.status} ${errorText}`);
          }

          done++;
        } catch (e) {
          errors.push({ file: name, error: e && e.message ? e.message : String(e) });
        }
      }

      const nextCursor = start + step < webdavFiles.length ? start + step : null;
      const processed = slice.length;
      const status = errors.length === processed ? 500 : errors.length ? 207 : 200;
      res.status(status).json({
        ok: errors.length === 0,
        total: webdavFiles.length,
        processed,
        restored: done,
        skipped,
        nextCursor,
        errors,
      });
    } else {
      res.status(400).json({ error: '未知操作' });
    }
  } catch (e) {
    console.error('WebDAV error:', e);
    res.status(500).json({ error: e.message || 'WebDAV 操作失败' });
  }
});

app.get('/api/r2', async (req, res) => {
  try {
    const s3Client = getR2Client();
    if (!s3Client) {
      return res.status(500).json({
        error: 'R2存储桶未配置',
        message: '请设置环境变量',
      });
    }

    const bucketName = R2_BUCKET_NAME;
    const action = req.query.action;
    const key = req.query.key;

    if (action === 'list') {
      try {
        const command = new ListObjectsV2Command({ Bucket: bucketName });
        const response = await s3Client.send(command);

        const objects = response.Contents || [];
        const audioFiles = objects
          .filter((obj) => {
            const name = obj.Key.toLowerCase();
            return AUDIO_EXTS.some((ext) => name.endsWith(ext));
          })
          .map((obj) => {
            const name = obj.Key;
            const title = filenameToDisplayTitle(name) || name;

            const url = `/api/r2?key=${encodeURIComponent(name)}`;

            return {
              name: name,
              title: title,
              url: url,
              size: obj.Size,
              uploaded: obj.LastModified,
            };
          });

        return res.status(200).json({
          success: true,
          total: audioFiles.length,
          data: audioFiles,
        });
      } catch (error) {
        console.error('[api/r2] 列表获取错误:', error);
        return res.status(500).json({
          error: '获取歌曲列表失败',
          message: error.message,
        });
      }
    }

    if (action === 'sign') {
      const key = req.query.key || '';
      const contentType = req.query.contentType || 'application/octet-stream';
      const expires = Number(req.query.expires || 900);

      if (!key) {
        return res.status(400).json({ error: '缺少 key 参数' });
      }

      try {
        const { uploadUrl } = createPresignedPutUrl({
          accountId: process.env.ACCOUNT_ID,
          accessKeyId: process.env.ACCESS_KEY_ID,
          secretAccessKey: process.env.SECRET_ACCESS_KEY,
          bucket: bucketName,
          key,
          contentType,
          expires,
        });

        return res.json({
          success: true,
          uploadUrl,
          key,
          expires,
          contentType,
          headers: {},
          accessUrl: `/api/r2?key=${encodeURIComponent(key)}`,
        });
      } catch (error) {
        console.error('[api/r2] 预签名失败:', error);
        return res.status(500).json({ error: '生成预签名URL失败', message: error.message });
      }
    }

    if (!key) {
      return res.status(400).json({ error: '缺少 key 参数' });
    }

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      let contentType = 'audio/mpeg';
      let contentLength = 0;

      try {
        const headResponse = await s3Client.send(headCommand);
        contentType = headResponse.ContentType || 'audio/mpeg';
        contentLength = headResponse.ContentLength || 0;
      } catch (headError) {
        if (headError.name === 'NotFound') {
          return res.status(404).json({ error: '文件不存在' });
        }
        throw headError;
      }

      const fileNameLower = key.toLowerCase();
      if (fileNameLower.endsWith('.mp3')) contentType = 'audio/mpeg';
      else if (fileNameLower.endsWith('.wav')) contentType = 'audio/wav';
      else if (fileNameLower.endsWith('.flac')) contentType = 'audio/flac';
      else if (fileNameLower.endsWith('.aac')) contentType = 'audio/aac';
      else if (fileNameLower.endsWith('.m4a')) contentType = 'audio/mp4';
      else if (fileNameLower.endsWith('.ogg')) contentType = 'audio/ogg';
      else if (fileNameLower.endsWith('.opus')) contentType = 'audio/opus';
      else if (fileNameLower.endsWith('.webm')) contentType = 'audio/webm';

      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : contentLength - 1;

          const getCommand = new GetObjectCommand({
            Bucket: bucketName,
            Key: key,
            Range: `bytes=${start}-${end}`,
          });

          const objectResponse = await s3Client.send(getCommand);
          const chunks = [];
          for await (const chunk of objectResponse.Body) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${contentLength}`);
          res.setHeader('Content-Length', buffer.length);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

          return res.status(206).send(buffer);
        }
      }

      const getCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const objectResponse = await s3Client.send(getCommand);
      const chunks = [];
      for await (const chunk of objectResponse.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      return res.status(200).send(buffer);
    } catch (error) {
      console.error('[api/r2] 文件获取错误:', error);
      if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
        return res.status(404).json({ error: '文件不存在' });
      }
      return res.status(500).json({
        error: '获取文件失败',
        message: error.message,
      });
    }
  } catch (error) {
    console.error('[api/r2] 错误:', error);
    return res.status(500).json({
      error: 'R2 API 错误',
      message: error.message,
    });
  }
});

app.post('/api/r2', upload.single('file'), async (req, res) => {
  try {
    const s3Client = getR2Client();
    if (!s3Client) {
      return res.status(500).json({
        error: 'R2存储桶未配置',
        message: '请设置环境变量',
      });
    }

    const bucketName = R2_BUCKET_NAME;
    const contentType = req.headers['content-type'] || '';

    let fileName = '';
    let fileData = null;
    let mimeType = 'audio/mpeg';

    if (contentType.includes('multipart/form-data')) {
      fileName = String(req.body.fileName || '').trim();
      const file = req.file;
      if (!fileName && file && file.originalname) fileName = file.originalname;
      if (!fileName) {
        return res.status(400).json({ error: '缺少 fileName' });
      }
      if (file && file.buffer) {
        fileData = file.buffer;
      } else {
        return res.status(400).json({ error: '缺少文件数据' });
      }
    } else {
      const body = req.body;
      fileName = body.fileName || '';

      if (!fileName) {
        return res.status(400).json({ error: '缺少 fileName' });
      }
    }

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: fileName,
      });
      await s3Client.send(headCommand);
      return res.status(409).json({ error: '文件已存在', exists: true });
    } catch {}

    if (!fileData) {
      const body = req.body;
      const base64 = body.base64 || '';
      const sourceUrl = body.sourceUrl || '';

      if (base64) {
        fileData = Buffer.from(base64, 'base64');
      } else if (sourceUrl) {
        try {
          const upstream = await fetch(sourceUrl, {
            redirect: 'follow',
            headers: {
              'User-Agent': 'web-music-player/0.1',
              Accept: 'audio/*,*/*',
            },
          });

          if (!upstream.ok) {
            return res.status(502).json({
              error: `下载源文件失败: ${upstream.status}`,
            });
          }

          const arrayBuf = await upstream.arrayBuffer();
          fileData = Buffer.from(arrayBuf);
          const contentTypeHeader = upstream.headers.get('content-type');
          if (contentTypeHeader) {
            mimeType = contentTypeHeader;
          }
        } catch (e) {
          return res.status(502).json({
            error: `下载源文件错误: ${e.message}`,
          });
        }
      } else {
        return res.status(400).json({ error: '缺少文件数据、base64 或 sourceUrl' });
      }
    }

    const fileNameLower = fileName.toLowerCase();
    if (fileNameLower.endsWith('.mp3')) mimeType = 'audio/mpeg';
    else if (fileNameLower.endsWith('.wav')) mimeType = 'audio/wav';
    else if (fileNameLower.endsWith('.flac')) mimeType = 'audio/flac';
    else if (fileNameLower.endsWith('.aac')) mimeType = 'audio/aac';
    else if (fileNameLower.endsWith('.m4a')) mimeType = 'audio/mp4';
    else if (fileNameLower.endsWith('.ogg')) mimeType = 'audio/ogg';
    else if (fileNameLower.endsWith('.opus')) mimeType = 'audio/opus';
    else if (fileNameLower.endsWith('.webm')) mimeType = 'audio/webm';

    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: fileData,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    });

    await s3Client.send(putCommand);

    const rawUrl = `/api/r2?key=${encodeURIComponent(fileName)}`;

    return res.status(200).json({
      ok: true,
      rawUrl,
    });
  } catch (error) {
    console.error('[api/r2] POST 错误:', error);
    return res.status(500).json({
      error: 'R2 上传错误',
      message: error.message,
    });
  }
});

app.use(express.static(join(__dirname, 'dist')));
app.use('/public', express.static(join(__dirname, 'public')));
app.use('/images', express.static(join(__dirname, 'public', 'images')));
app.use('/music', express.static(join(__dirname, 'public', 'music')));
app.use('/covers', express.static(join(__dirname, 'public', 'covers')));
app.use('/favicon.ico', express.static(join(__dirname, 'public', 'favicon.ico')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: '服务器内部错误',
    message: err.message || '出现了未知错误，请稍后重试',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 音乐服务运行在端口 ${PORT}`);
  console.log(`📁 静态文件服务目录: ${join(__dirname, 'dist')}`);
  console.log(`🔧 运行环境: ${loadedEnvFile ? '本地 (.env)' : 'process.env / 平台注入'}`);

  const requiredEnvVars = ['GIT_REPO', 'GIT_TOKEN', 'PASSWORD'];
  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.warn(`⚠️  缺少必要的环境变量: ${missingVars.join(', ')}`);
    console.warn('   某些功能可能无法正常工作');
  } else {
    console.log('✅ 所有必要的环境变量已设置');
  }
});

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在优雅关闭服务器');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，正在优雅关闭服务器');
  process.exit(0);
});
