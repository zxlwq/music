import {
  BASE_URL,
  DEFAULT_BITRATE,
  DEFAULT_PIC_SIZE,
  DEFAULT_SEARCH_COUNT,
  DEFAULT_SOURCE,
} from './config.js';

function buildUrl(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  return `${BASE_URL}?${q.toString()}`;
}

async function getJson(url, { signal } = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.detail || body?.error || '';
    } catch {
      /* ignore */
    }
    const err = new Error(detail || `GD Studio API ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json();
}

function isUnsupportedSourceError(e) {
  const msg = String(e?.detail || e?.message || '');
  return e?.status === 400 && /source/i.test(msg) && /not supported/i.test(msg);
}

/**
 * 搜索曲目
 * @returns {Promise<Array>} 原始 API 条目；源未开放时返回 []（不抛错）
 */
export async function searchRaw(
  name,
  { source = DEFAULT_SOURCE, count = DEFAULT_SEARCH_COUNT, pages = 1, signal } = {},
) {
  const keyword = String(name || '').trim();
  if (!keyword) return [];
  try {
    const data = await getJson(
      buildUrl({
        types: 'search',
        source,
        name: keyword,
        count,
        pages,
      }),
      { signal },
    );
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (isUnsupportedSourceError(e)) {
      return [];
    }
    throw e;
  }
}

/** 解析可播放链接 */
export async function fetchPlayUrl(
  id,
  { source = DEFAULT_SOURCE, br = DEFAULT_BITRATE, signal } = {},
) {
  if (!id) throw new Error('缺少曲目 id');
  const data = await getJson(
    buildUrl({
      types: 'url',
      source,
      id,
      br,
    }),
    { signal },
  );
  const url = data?.url;
  if (!url) throw new Error('未获取到播放链接');
  return {
    url: String(url),
    br: data.br,
    size: data.size,
  };
}

/** 解析封面链接 */
export async function fetchPicUrl(
  picId,
  { source = DEFAULT_SOURCE, size = DEFAULT_PIC_SIZE, signal } = {},
) {
  if (!picId) return '';
  const data = await getJson(
    buildUrl({
      types: 'pic',
      source,
      id: picId,
      size,
    }),
    { signal },
  );
  return data?.url ? String(data.url) : '';
}

/** 歌词 */
export async function fetchLyric(lyricId, { source = DEFAULT_SOURCE, signal } = {}) {
  if (!lyricId) return { lyric: '', tlyric: '' };
  const data = await getJson(
    buildUrl({
      types: 'lyric',
      source,
      id: lyricId,
    }),
    { signal },
  );
  return {
    lyric: data?.lyric ? String(data.lyric) : '',
    tlyric: data?.tlyric ? String(data.tlyric) : '',
  };
}
