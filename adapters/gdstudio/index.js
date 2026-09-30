import {
  DEFAULT_SEARCH_COUNT,
  DEFAULT_SEARCH_PAGES,
  DEFAULT_SOURCE,
  ENABLED,
  PROVIDER_ID,
  PROXY_PATH,
  SEARCH_SOURCES,
} from './config.js';
import { isProviderTrack, mapSearchResults } from './mapper.js';

export { ENABLED, PROVIDER_ID, PROXY_PATH, isProviderTrack };

async function searchOnePage(name, { source, count, page, signal }) {
  const q = new URLSearchParams({
    types: 'search',
    source,
    name,
    count: String(count),
    pages: String(page),
  });

  const res = await fetch(`${PROXY_PATH}?${q.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `在线搜索失败 (${res.status})`);
  }

  const data = await res.json();
  if (Array.isArray(data?.tracks) && data.tracks.length) {
    return data.tracks;
  }
  if (Array.isArray(data?.raw)) {
    return mapSearchResults(data.raw, { source });
  }
  return [];
}

/** 单源多页并行拉取后合并 */
async function searchOneSource(name, { source, count, pages, signal }) {
  const pageCount = Math.max(1, Number(pages) || 1);
  const settled = await Promise.allSettled(
    Array.from({ length: pageCount }, (_, i) =>
      searchOnePage(name, { source, count, page: i + 1, signal }),
    ),
  );

  const lists = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') lists.push(item.value);
  }
  return mergeTracks(lists);
}

function mergeTracks(lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const track of list) {
      const key = track?.url || `${track?.meta?.source}:${track?.meta?.id}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(track);
    }
  }
  return out;
}

/**
 * 前端在线搜索：走本站 /api/gdstudio，不直连上游（避免 CORS / 被墙）
 *
 * @param {string} keyword
 * @param {object} [options]
 * @param {string} [options.source] 单个源；不传则用 SEARCH_SOURCES（可多源）
 * @param {string[]} [options.sources] 多个源，优先于 source / SEARCH_SOURCES
 * @param {number} [options.count] 每页条数，默认 DEFAULT_SEARCH_COUNT
 * @param {number} [options.pages] 每个源拉几页，默认 DEFAULT_SEARCH_PAGES
 * @param {AbortSignal} [options.signal]
 */
export async function searchOnline(
  keyword,
  { source, sources, count = DEFAULT_SEARCH_COUNT, pages = DEFAULT_SEARCH_PAGES, signal } = {},
) {
  if (!ENABLED) return [];
  const name = String(keyword || '').trim();
  if (!name) return [];

  const sourceList =
    Array.isArray(sources) && sources.length
      ? sources
      : source
        ? [source]
        : Array.isArray(SEARCH_SOURCES) && SEARCH_SOURCES.length
          ? SEARCH_SOURCES
          : [DEFAULT_SOURCE];

  const uniqueSources = [...new Set(sourceList.map(String).filter(Boolean))];
  if (!uniqueSources.length) return [];

  const settled = await Promise.allSettled(
    uniqueSources.map((src) => searchOneSource(name, { source: src, count, pages, signal })),
  );

  const lists = [];
  let failCount = 0;
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      lists.push(item.value);
    } else {
      failCount += 1;
    }
  }

  const merged = mergeTracks(lists);
  // 仅在全部失败时提示；部分源失败但已有结果时不刷红控制台
  if (!merged.length && failCount === uniqueSources.length) {
    console.warn('在线搜索失败：所有音乐源均不可用');
  }

  return merged;
}
