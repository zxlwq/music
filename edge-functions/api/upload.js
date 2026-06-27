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

export function onRequest(context) {
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

  return handleUpload(request, env, corsHeaders);
}

async function handleUpload(request, env, corsHeaders) {
  try {
    const ct = request.headers.get('content-type') || '';
    let fileName = '';
    let base64 = '';
    let sourceUrl = '';

    const proxyUrl = env.GIT_URL;
    const builtinProxyUrl = '/api/audio';
    const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

    if (/multipart\/form-data/i.test(ct)) {
      const form = await request.formData();
      fileName = String(form.get('fileName') || '').trim();
      const file = form.get('file');
      if (!fileName && file && file.name) fileName = file.name;
      if (!fileName) {
        return new Response(JSON.stringify({ error: 'Missing fileName' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
      if (file && typeof file.arrayBuffer === 'function') {
        const buf = await file.arrayBuffer();
        base64 = arrayBufferToBase64(buf);
      } else {
        return new Response(JSON.stringify({ error: 'Missing file blob' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
    } else {
      const body = await request.json();
      fileName = body?.fileName || '';
      base64 = body?.base64 || '';
      sourceUrl = body?.sourceUrl || '';
      if (!fileName) {
        return new Response(JSON.stringify({ error: 'Missing fileName' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
    }

    const repoFull = env.GIT_REPO;
    const token = env.GIT_TOKEN;
    const branch = env.GIT_BRANCH || 'main';

    if (!repoFull || !token) {
      return new Response(
        JSON.stringify({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }

    const [owner, repo] = String(repoFull).split('/');
    const encodedName = encodeURIComponent(fileName);
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}?ref=${encodeURIComponent(branch)}`;
    const meta = await proxyFetch(metaApi, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (EdgeOne Pages Function)',
      },
    });

    if (meta.status === 200) {
      return new Response(JSON.stringify({ error: 'File already exists', exists: true }), {
        status: 409,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    let contentB64 = base64;
    if (!contentB64) {
      if (!sourceUrl) {
        return new Response(JSON.stringify({ error: 'Missing base64 or sourceUrl' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
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
          return new Response(
            JSON.stringify({
              error: `Fetch source failed: ${upstream.status} ${text || ''}`.trim(),
            }),
            {
              status: 502,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            },
          );
        }
        const buf = await upstream.arrayBuffer();
        contentB64 = arrayBufferToBase64(buf);
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message || 'Fetch source error' }), {
          status: 502,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
    }

    const api = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}`;
    const putRes = await proxyFetch(api, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'web-music-player/0.1 (EdgeOne Pages Function)',
      },
      body: JSON.stringify({
        message: `Add music: ${fileName}`,
        content: contentB64,
        branch,
      }),
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return new Response(JSON.stringify({ error: t }), {
        status: putRes.status,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/public/music/${encodedName}`;
    return new Response(JSON.stringify({ ok: true, rawUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('Upload error:', e);
    return new Response(JSON.stringify({ error: e.message || 'upload error' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}
