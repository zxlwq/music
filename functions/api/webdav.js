const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];
const isAudio = (name) =>
  AUDIO_EXTS.some((ext) =>
    String(name || '')
      .toLowerCase()
      .endsWith(ext),
  );

function createProxyFetch(proxyUrl, builtinProxyUrl) {
  if (!proxyUrl && !builtinProxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[webdav] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[webdav] Direct request error: ${error.message}, trying proxy...`);
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
              'X-Proxy-Type': 'github-webdav',
            },
          };

          console.log(`[webdav] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          console.log(`[webdav] Builtin proxy failed: ${error.message}`);
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
            'X-Proxy-Type': 'github-webdav',
          },
        };

        console.log(`[webdav] Using custom proxy: ${proxiedUrl}`);
        return fetch(proxiedUrl, proxyOptions);
      }
    }

    return fetch(url, options);
  };
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
      'User-Agent': 'web-music-player/0.1',
    },
  });
  if (!res.ok) throw new Error(`GitHub list failed: ${res.status} ${await res.text()}`);
  const items = await res.json();
  return (Array.isArray(items) ? items : []).filter(
    (it) => it && it.type === 'file' && isAudio(it.name),
  );
}

// 保留以备将来使用
// eslint-disable-next-line no-unused-vars
async function getGithubFileBase64({ repoFull, token, branch, pathInRepo, proxyFetch = fetch }) {
  const [owner, repo] = String(repoFull).split('/');
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`;
  const res = await proxyFetch(api, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'web-music-player/0.1',
    },
  });
  if (!res.ok) throw new Error(`GitHub get failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data && data.content;
}

function resolveMusicBase(base, env) {
  const webdavPath = env?.WEBDAV_PATH || 'music';
  const b = String(base || '').replace(/\/+$/g, '');
  return `${b}/${webdavPath}`;
}
function joinUrl(base, name, env) {
  const b = resolveMusicBase(base, env).replace(/\/+$/g, '');
  const n = encodeURIComponent(name);
  return `${b}/${n}`;
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
    if (!res.ok) throw new Error(`WebDAV MKCOL failed: ${res.status} ${await res.text()}`);
  }
}

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

async function webdavPut({
  baseUrl,
  user,
  pass,
  name,
  body,
  contentType = 'application/octet-stream',
  env,
}) {
  const url = joinUrl(baseUrl, name, env);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      Authorization: buildBasicAuth(user, pass),
      Overwrite: 'T',
    },
    body,
  });
  if (!res.ok) throw new Error(`WebDAV PUT failed: ${res.status} ${await res.text()}`);
}

async function webdavDelete({ baseUrl, user, pass, name, env }) {
  const url = joinUrl(baseUrl, name, env);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: buildBasicAuth(user, pass) },
  });
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
    throw new Error(`WebDAV DELETE failed: ${res.status} ${await res.text()}`);
  }
}

async function webdavMove({ baseUrl, user, pass, srcName, dstName, env }) {
  const srcUrl = joinUrl(baseUrl, srcName, env);
  const dstUrl = joinUrl(baseUrl, dstName, env);
  const res = await fetch(srcUrl, {
    method: 'MOVE',
    headers: {
      Authorization: buildBasicAuth(user, pass),
      Destination: dstUrl,
      Overwrite: 'T',
    },
  });
  if (!(res.status === 201 || res.status === 204)) {
    throw new Error(`WebDAV MOVE failed: ${res.status} ${await res.text()}`);
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

// 保留以备将来使用
// eslint-disable-next-line no-unused-vars
async function webdavPutWithOverwrite({ baseUrl, user, pass, name, body }) {
  try {
    await webdavPut({ baseUrl, user, pass, name, body });
    return;
  } catch (e) {
    const msg = e && e.message ? e.message : '';
    if (!(/\b409\b/.test(msg) || /Conflict/i.test(msg))) throw e;
  }

  const tmp = `.__upload_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.part`;
  try {
    await webdavPut({ baseUrl, user, pass, name: tmp, body });
    await webdavMove({ baseUrl, user, pass, srcName: tmp, dstName: name });
    return;
  } catch {
    try {
      await webdavDelete({ baseUrl, user, pass, name: tmp });
    } catch {}
  }

  for (let i = 0; i < 3; i++) {
    try {
      await webdavDelete({ baseUrl, user, pass, name });
    } catch {}
    await sleep(200 * (i + 1));
    try {
      await webdavPut({ baseUrl, user, pass, name, body });
      return;
    } catch (e3) {
      const m3 = e3 && e3.message ? e3.message : '';
      if (!(/\b409\b/.test(m3) || /Conflict/i.test(m3))) throw e3;
    }
  }
  throw new Error(`WebDAV overwrite failed (${name}): still conflict after retries`);
}

async function webdavPropfind({ baseUrl, user, pass, env }) {
  const url = resolveMusicBase(baseUrl, env).replace(/\/+$/g, '') + '/';
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Depth: '1',
      Authorization: buildBasicAuth(user, pass),
    },
  });
  if (!res.ok) throw new Error(`WebDAV PROPFIND failed: ${res.status} ${await res.text()}`);
  const text = await res.text();

  const hrefs = Array.from(
    text.matchAll(/<\s*[^:>]*:?href\s*>\s*([^<]+)\s*<\s*\/\s*[^:>]*:?href\s*>/gi),
  ).map((m) => m[1]);

  const names = [];
  try {
    const base = new URL(url);
    for (const h of hrefs) {
      try {
        const u = new URL(h, base);
        const pathname = decodeURIComponent(u.pathname);
        const segs = pathname.split('/').filter(Boolean);
        const last = segs.pop() || '';
        if (last && isAudio(last)) names.push(last);
      } catch {}
    }
  } catch {}

  return Array.from(new Set(names));
}

async function webdavGet({ baseUrl, user, pass, name, env }) {
  const url = joinUrl(baseUrl, name, env);
  const res = await fetch(url, { headers: { Authorization: buildBasicAuth(user, pass) } });
  if (!res.ok) throw new Error(`WebDAV GET failed: ${res.status} ${await res.text()}`);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

function uint8ToBase64(u8) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    const sub = u8.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

async function githubPut({ repoFull, token, branch, pathInRepo, base64, proxyFetch = fetch }) {
  const [owner, repo] = String(repoFull).split('/');
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}`;
  const res = await proxyFetch(api, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'web-music-player/0.1',
    },
    body: JSON.stringify({ message: `Sync via WebDAV: ${pathInRepo}`, content: base64, branch }),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const { action, cursor, limit } = await request.json();
    const repoFull = env.GIT_REPO;
    const token = env.GIT_TOKEN;
    const branch = env.GIT_BRANCH || 'main';
    const wUrl = env.WEBDAV_URL;
    const wUser = env.WEBDAV_USER;
    const wPass = env.WEBDAV_PASS;

    const proxyUrl = env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

    if (!repoFull || !token) {
      return new Response(
        JSON.stringify({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }
    if (!wUrl || !wUser || !wPass) {
      return new Response(
        JSON.stringify({
          error: 'Server not configured: WEBDAV_URL/WEBDAV_USER/WEBDAV_PASS missing',
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }

    if (action === 'upload') {
      await ensureWebdavDir({ baseUrl: wUrl, user: wUser, pass: wPass, env });
      const files = await listGithubMusic({ repoFull, token, branch, proxyFetch });
      if (!files.length) {
        return new Response(
          JSON.stringify({ ok: true, total: 0, uploaded: 0, message: 'No audio files in repo' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      let existingNames = [];
      try {
        existingNames = await webdavPropfind({ baseUrl: wUrl, user: wUser, pass: wPass, env });
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
            headers: { 'User-Agent': 'web-music-player/0.1', Accept: 'application/octet-stream' },
          });
          if (!rawRes.ok) {
            const t = await rawRes.text().catch(() => '');
            throw new Error(`Fetch file failed: ${rawRes.status} ${t}`);
          }
          const buf = new Uint8Array(await rawRes.arrayBuffer());

          await webdavPut({ baseUrl: wUrl, user: wUser, pass: wPass, name, body: buf, env });
          done++;
        } catch (e) {
          errors.push({ file: name, error: e && e.message ? e.message : String(e) });
        }
      }
      const nextCursor = start + step < files.length ? start + step : null;
      const processed = slice.length;
      const status = errors.length === processed ? 500 : errors.length ? 207 : 200;
      return new Response(
        JSON.stringify({
          ok: errors.length === 0,
          total: files.length,
          processed,
          uploaded: done,
          skipped,
          nextCursor,
          errors,
        }),
        { status, headers: { 'content-type': 'application/json' } },
      );
    } else if (action === 'restore') {
      const names = await webdavPropfind({ baseUrl: wUrl, user: wUser, pass: wPass, env });
      if (!names.length)
        return new Response(JSON.stringify({ ok: true, total: 0, restored: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });

      let existing = [];
      try {
        const ghFiles = await listGithubMusic({ repoFull, token, branch, proxyFetch });
        existing = (ghFiles || []).map((f) => f && f.name).filter(Boolean);
      } catch {}
      const existingSet = new Set(existing);
      const start = Math.max(0, Number(cursor) || 0);
      const step = Math.max(1, Math.min(Number(limit) || 3, 10));
      const slice = names.slice(start, start + step);
      let done = 0;
      let skipped = 0;
      const errors = [];
      for (const name of slice) {
        try {
          if (existingSet.has(name)) {
            skipped++;
            continue;
          }
          const data = await webdavGet({ baseUrl: wUrl, user: wUser, pass: wPass, name, env });
          const base64 = uint8ToBase64(data);
          const pathInRepo = `public/music/${name}`;
          await githubPut({ repoFull, token, branch, pathInRepo, base64, proxyFetch });
          done++;
        } catch (e) {
          errors.push({ file: name, error: e && e.message ? e.message : String(e) });
        }
      }
      const nextCursor = start + step < names.length ? start + step : null;
      const processed = slice.length;
      const status = errors.length === processed ? 500 : errors.length ? 207 : 200;
      return new Response(
        JSON.stringify({
          ok: errors.length === 0,
          total: names.length,
          processed,
          restored: done,
          skipped,
          nextCursor,
          errors,
        }),
        { status, headers: { 'content-type': 'application/json' } },
      );
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'webdav error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
    },
  });
};
