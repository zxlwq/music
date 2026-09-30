import {
  DEFAULT_BITRATE,
  DEFAULT_PIC_SIZE,
  DEFAULT_SEARCH_COUNT,
  DEFAULT_SOURCE,
  ENABLED,
} from './config.js';
import { fetchLyric, fetchPicUrl, fetchPlayUrl, searchRaw } from './client.js';
import { mapSearchResults } from './mapper.js';

function pickQuery(query, key, fallback) {
  if (!query || typeof query !== 'object') return fallback;
  const raw = query[key];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === undefined || val === null || val === '') return fallback;
  return String(val);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function sendRedirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end();
}

/**
 * Express / Vercel Node 风格处理器
 * GET /api/gdstudio?types=search|play|url|pic|lyric&...
 */
export async function handleGdstudioRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!ENABLED) {
    sendJson(res, 503, { error: 'GD Studio adapter disabled' });
    return;
  }

  try {
    const query = req.query || {};
    const types = pickQuery(query, 'types', 'search');
    const source = pickQuery(query, 'source', DEFAULT_SOURCE);

    if (types === 'search') {
      const name = pickQuery(query, 'name', '');
      if (!name.trim()) {
        sendJson(res, 400, { error: '缺少 name' });
        return;
      }
      const count = Number(pickQuery(query, 'count', DEFAULT_SEARCH_COUNT)) || DEFAULT_SEARCH_COUNT;
      const pages = Number(pickQuery(query, 'pages', 1)) || 1;
      const raw = await searchRaw(name, { source, count, pages });
      const tracks = mapSearchResults(raw, { source });
      sendJson(res, 200, { ok: true, provider: 'gdstudio', tracks, raw });
      return;
    }

    if (types === 'url') {
      const id = pickQuery(query, 'id', '');
      const br = Number(pickQuery(query, 'br', DEFAULT_BITRATE)) || DEFAULT_BITRATE;
      const data = await fetchPlayUrl(id, { source, br });
      sendJson(res, 200, { ok: true, ...data });
      return;
    }

    if (types === 'play') {
      const id = pickQuery(query, 'id', '');
      const br = Number(pickQuery(query, 'br', DEFAULT_BITRATE)) || DEFAULT_BITRATE;
      const data = await fetchPlayUrl(id, { source, br });
      // 走现有音频代理，统一鉴权/Range/缓存逻辑
      const proxy = `/api/audio?url=${encodeURIComponent(data.url)}`;
      sendRedirect(res, proxy);
      return;
    }

    if (types === 'pic') {
      const id = pickQuery(query, 'id', '');
      const size = Number(pickQuery(query, 'size', DEFAULT_PIC_SIZE)) || DEFAULT_PIC_SIZE;
      const url = await fetchPicUrl(id, { source, size });
      if (!url) {
        sendJson(res, 404, { error: '封面不存在' });
        return;
      }
      sendRedirect(res, url);
      return;
    }

    if (types === 'lyric') {
      const id = pickQuery(query, 'id', '');
      const data = await fetchLyric(id, { source });
      sendJson(res, 200, { ok: true, ...data });
      return;
    }

    sendJson(res, 400, { error: `未知 types: ${types}` });
  } catch (e) {
    console.error('[gdstudio]', e);
    sendJson(res, 502, { error: e?.message || 'GD Studio 请求失败' });
  }
}

/**
 * Cloudflare / EdgeOne：Web Fetch API Response
 */
export async function handleGdstudioFetch(request) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  if (!ENABLED) {
    return new Response(JSON.stringify({ error: 'GD Studio adapter disabled' }), {
      status: 503,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const types = url.searchParams.get('types') || 'search';
    const source = url.searchParams.get('source') || DEFAULT_SOURCE;

    if (types === 'search') {
      const name = url.searchParams.get('name') || '';
      if (!name.trim()) {
        return new Response(JSON.stringify({ error: '缺少 name' }), {
          status: 400,
          headers: { ...cors, 'content-type': 'application/json' },
        });
      }
      const count =
        Number(url.searchParams.get('count') || DEFAULT_SEARCH_COUNT) || DEFAULT_SEARCH_COUNT;
      const pages = Number(url.searchParams.get('pages') || 1) || 1;
      const raw = await searchRaw(name, { source, count, pages });
      const tracks = mapSearchResults(raw, { source });
      return new Response(JSON.stringify({ ok: true, provider: 'gdstudio', tracks, raw }), {
        status: 200,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      });
    }

    if (types === 'url') {
      const id = url.searchParams.get('id') || '';
      const br = Number(url.searchParams.get('br') || DEFAULT_BITRATE) || DEFAULT_BITRATE;
      const data = await fetchPlayUrl(id, { source, br });
      return new Response(JSON.stringify({ ok: true, ...data }), {
        status: 200,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      });
    }

    if (types === 'play') {
      const id = url.searchParams.get('id') || '';
      const br = Number(url.searchParams.get('br') || DEFAULT_BITRATE) || DEFAULT_BITRATE;
      const data = await fetchPlayUrl(id, { source, br });
      const proxy = `/api/audio?url=${encodeURIComponent(data.url)}`;
      return Response.redirect(new URL(proxy, url.origin).toString(), 302);
    }

    if (types === 'pic') {
      const id = url.searchParams.get('id') || '';
      const size = Number(url.searchParams.get('size') || DEFAULT_PIC_SIZE) || DEFAULT_PIC_SIZE;
      const pic = await fetchPicUrl(id, { source, size });
      if (!pic) {
        return new Response(JSON.stringify({ error: '封面不存在' }), {
          status: 404,
          headers: { ...cors, 'content-type': 'application/json' },
        });
      }
      return Response.redirect(pic, 302);
    }

    if (types === 'lyric') {
      const id = url.searchParams.get('id') || '';
      const data = await fetchLyric(id, { source });
      return new Response(JSON.stringify({ ok: true, ...data }), {
        status: 200,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(JSON.stringify({ error: `未知 types: ${types}` }), {
      status: 400,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  } catch (e) {
    console.error('[gdstudio]', e);
    return new Response(JSON.stringify({ error: e?.message || 'GD Studio 请求失败' }), {
      status: 502,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }
}
