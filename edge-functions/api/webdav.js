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

function joinUrl(base, name, env) {
  const b = resolveMusicBase(base, env).replace(/\/+$/g, '');
  const n = encodeURIComponent(name);
  return `${b}/${n}`;
}

async function ensureWebdavDir({ baseUrl, user, pass, env }) {
  const url = resolveMusicBase(baseUrl, env) + '/';

  try {
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
        console.log(`[webdav] MKCOL failed: ${res.status} ${errorText}`);
      }
    }
  } catch (error) {
    console.log(`[webdav] MKCOL error: ${error.message}`);
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
      'User-Agent': 'web-music-player/0.1',
    },
  });
  if (!res.ok) throw new Error(`GitHub list failed: ${res.status} ${await res.text()}`);
  const items = await res.json();
  return (Array.isArray(items) ? items : []).filter(
    (it) => it && it.type === 'file' && isAudio(it.name),
  );
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
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { action, cursor, limit } = body;
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
        {
          status: 500,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }
    if (!wUrl || !wUser || !wPass) {
      return new Response(
        JSON.stringify({
          error: 'Server not configured: WEBDAV_URL/WEBDAV_USER/WEBDAV_PASS missing',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }

    if (action === 'upload') {
      await ensureWebdavDir({ baseUrl: wUrl, user: wUser, pass: wPass, env });
      const files = await listGithubMusic({ repoFull, token, branch, proxyFetch });
      if (!files.length) {
        return new Response(
          JSON.stringify({ ok: true, total: 0, uploaded: 0, message: 'No audio files in repo' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          },
        );
      }

      let existingNames = [];
      try {
        const url = resolveMusicBase(wUrl, env).replace(/\/+$/g, '') + '/';
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
              'User-Agent': 'web-music-player/0.1',
              Accept: 'application/octet-stream',
            },
          });
          if (!rawRes.ok) {
            const t = await rawRes.text().catch(() => '');
            throw new Error(`Fetch file failed: ${rawRes.status} ${t}`);
          }
          const buf = new Uint8Array(await rawRes.arrayBuffer());

          const url = joinUrl(wUrl, name, env);
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
        {
          status,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    } else if (action === 'restore') {
      await ensureWebdavDir({ baseUrl: wUrl, user: wUser, pass: wPass, env });
      let webdavFiles = [];
      try {
        const baseUrl = resolveMusicBase(wUrl, env);
        const url = baseUrl.replace(/\/+$/g, '') + '/';

        let res = await fetch(url, {
          method: 'PROPFIND',
          headers: {
            Depth: '1',
            Authorization: buildBasicAuth(wUser, wPass),
            'Content-Type': 'application/xml',
          },
        });

        if (!res.ok && res.status === 405) {
          console.log('[webdav] PROPFIND not supported, trying alternative method');
          res = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: buildBasicAuth(wUser, wPass),
            },
          });
        }

        if (!res.ok && res.status === 405) {
          console.log('[webdav] GET also failed, checking supported methods');
          const optionsRes = await fetch(url, {
            method: 'OPTIONS',
            headers: {
              Authorization: buildBasicAuth(wUser, wPass),
            },
          });
          console.log(
            '[webdav] OPTIONS response:',
            optionsRes.status,
            optionsRes.headers.get('Allow'),
          );
        }

        if (res.ok) {
          const text = await res.text();
          console.log('[webdav] WebDAV response:', text.substring(0, 500));

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
        } else {
          console.log('[webdav] WebDAV list failed:', res.status, await res.text().catch(() => ''));
        }
      } catch (error) {
        console.log('[webdav] WebDAV list error:', error.message);
      }

      if (!webdavFiles.length) {
        console.log('[webdav] No files found via WebDAV listing, trying alternative approach');
        try {
          const githubFiles = await listGithubMusic({ repoFull, token, branch, proxyFetch });
          console.log(`[webdav] Found ${githubFiles.length} files in GitHub repo`);

          for (const file of githubFiles.slice(0, 10)) {
            try {
              const webdavUrl = joinUrl(wUrl, file.name, env);
              const checkRes = await fetch(webdavUrl, {
                method: 'HEAD',
                headers: {
                  Authorization: buildBasicAuth(wUser, wPass),
                },
              });
              if (checkRes.ok) {
                webdavFiles.push({ name: file.name, download_url: webdavUrl });
              }
            } catch {}
          }
        } catch (error) {
          console.log('[webdav] Alternative approach failed:', error.message);
        }
      }

      if (!webdavFiles.length) {
        return new Response(
          JSON.stringify({
            ok: true,
            total: 0,
            restored: 0,
            message: 'No audio files found in WebDAV',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          },
        );
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
              'User-Agent': 'web-music-player/0.1',
            },
          });
          if (!downloadRes.ok) {
            throw new Error(`WebDAV download failed: ${downloadRes.status}`);
          }
          const buf = new Uint8Array(await downloadRes.arrayBuffer());

          // Convert Uint8Array to base64 without Buffer (browser-compatible)
          // Handle large arrays by chunking
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < buf.length; i += chunkSize) {
            const chunk = buf.slice(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
          }
          const content = btoa(binary);
          const uploadUrl = `https://api.github.com/repos/${repoFull}/contents/public/music/${encodeURIComponent(name)}`;
          const uploadRes = await proxyFetch(uploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'web-music-player/0.1',
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
      return new Response(
        JSON.stringify({
          ok: errors.length === 0,
          total: webdavFiles.length,
          processed,
          restored: done,
          skipped,
          nextCursor,
          errors,
        }),
        {
          status,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }
  } catch (e) {
    console.error('WebDAV error:', e);
    return new Response(JSON.stringify({ error: e.message || 'webdav error' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}
