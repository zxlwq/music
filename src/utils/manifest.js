import { preloadCoverImages } from './image';
import { getCoverUrlByIndex } from './covers';
import {
  getDeletedUrls,
  getExtraTracks,
  getOverrideTracks,
  reconcilePlaylistState,
  setExtraTracks,
  trackUrlIdentity,
} from './localState';

const parseListPayload = (j) => {
  if (!j || !Array.isArray(j.tracks)) return null;
  return { tracks: j.tracks };
};

/** 从当前版本 SW 静态缓存桶读取 music.json（仅离线兜底；在线不优先走缓存） */
async function tryReadMusicJsonFromStaticCaches() {
  if (typeof caches === 'undefined') return null;
  try {
    const names = await caches.keys();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!origin) return null;
    // 优先较新的桶名（含构建 hash 的通常字典序可区分；再按打开顺序尝试）
    const staticBuckets = names
      .filter((n) => /^music-static-/.test(n))
      .sort()
      .reverse();
    for (const name of staticBuckets) {
      const c = await caches.open(name);
      const res = await c.match(`${origin}/music.json`, { ignoreSearch: true });
      if (res && res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (!/json/i.test(ct)) continue;
        const j = await res.json();
        return parseListPayload(j);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isLikelyOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * 在线：短超时网络拉取 music.json（no-store）；离线或失败再读 Cache Storage。
 * 避免 force-cache 长期命中旧歌单。
 */
async function loadStaticManifestPreferNetwork(headers) {
  if (isLikelyOnline()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`/music.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers,
        signal: controller.signal,
      });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (/json/i.test(ct)) {
          const j = await res.json();
          return parseListPayload(j);
        }
      }
    } catch {
      /* fall through */
    } finally {
      clearTimeout(timer);
    }
  }
  return tryReadMusicJsonFromStaticCaches();
}

/** 歌单 API 超时（毫秒）。国内到远端边缘常 >3s，过短会 abort 成 canceled */
const MUSIC_LIST_TIMEOUT_MS = 10000;

/**
 * 并行请求 API 与静态 music.json：API 优先；静态作后备。
 * 在线均使用 no-store，避免被 SW/HTTP 旧缓存困住。
 */
export const loadManifest = async () => {
  try {
    const ts = Date.now();
    const headers = { accept: 'application/json' };

    const staticP = loadStaticManifestPreferNetwork(headers);

    const apiP = (async () => {
      if (!isLikelyOnline()) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MUSIC_LIST_TIMEOUT_MS);
      try {
        const r = await fetch(`/api/music/list?t=${ts}`, {
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!r.ok) {
          if (r.status === 503) {
            const errorData = await r.json().catch(() => ({}));
            if (errorData.error && errorData.error.includes('proxy')) {
              console.warn('检测到代理环境，GitHub API访问被阻止:', errorData);
            }
          }
          return null;
        }

        const ct = r.headers.get('content-type') || '';
        if (!/json/i.test(ct)) return null;
        const j = await r.json();
        return parseListPayload(j);
      } catch (error) {
        const aborted =
          error?.name === 'AbortError' ||
          (typeof error?.message === 'string' && /aborted|abort/i.test(error.message));
        if (aborted) {
          console.info(
            `[清单] /api/music/list 超过 ${MUSIC_LIST_TIMEOUT_MS}ms 未返回，改用静态 music.json`,
          );
        } else if (
          typeof error?.message === 'string' &&
          /fetch|network|Failed/i.test(error.message)
        ) {
          console.warn('[清单] 网络请求失败，将回退静态歌单:', error.message);
        }
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();

    const [fromApi, fromStatic] = await Promise.all([apiP, staticP]);
    let data = fromApi || fromStatic;

    if (!data) {
      try {
        const res = await fetch(`/music.json?t=${Date.now()}`, { headers, cache: 'no-store' });
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (/json/i.test(ct)) {
            const j = await res.json();
            data = parseListPayload(j);
          }
        }
      } catch {
        /* offline */
      }
    }

    if (!data) {
      data = await tryReadMusicJsonFromStaticCaches();
    }

    if (!data) {
      const override = getOverrideTracks();
      if (override.length > 0) {
        console.warn('清单不可用，使用本地歌单 overrideTracks（离线或缓存未命中时）');
        data = { tracks: override };
      }
    }

    if (!data) {
      throw new Error('加载清单失败');
    }

    if (!fromApi && fromStatic) {
      console.info('服务端列表暂不可用，已使用静态 music.json');
    }

    return data;
  } catch (e) {
    throw new Error(e.message || '清单加载错误');
  }
};
export const processTracks = (data) => {
  reconcilePlaylistState();

  const override = getOverrideTracks();
  const baseTracks = Array.isArray(data.tracks) ? data.tracks : [];
  const extra = getExtraTracks();

  const assignCovers = (list) => {
    let idx = 0;
    return (list || []).map((t) => {
      if (t && t.cover) return t;
      const assigned = { ...(t || {}) };
      assigned.cover = getCoverUrlByIndex(idx);
      idx++;
      return assigned;
    });
  };

  const applyDeletionFilter = (list) => {
    try {
      const del = getDeletedUrls();
      if (!Array.isArray(list) || !list.length || !del.length) return list;
      const delSet = new Set();
      for (const u of del) {
        const id = trackUrlIdentity(u);
        if (id) delSet.add(id);
        delSet.add(String(u));
      }
      return list.filter((it) => {
        if (!it?.url) return false;
        if (delSet.has(it.url)) return false;
        const id = trackUrlIdentity(it.url);
        if (id && delSet.has(id)) return false;
        return true;
      });
    } catch {
      return list;
    }
  };

  if (Array.isArray(override) && override.length) {
    const extra2 = getExtraTracks();
    const titleToExtra = new Map();
    for (const et of extra2) {
      if (et && et.title) titleToExtra.set(et.title, et);
    }
    const withCovers = assignCovers(override);
    const enriched = withCovers.map((t) => {
      const title = t?.title || '';
      const ext = titleToExtra.get(title);
      if (!ext) return t;
      const merged = { ...t };
      if (!merged.mvUrl && ext.mvUrl) merged.mvUrl = ext.mvUrl;
      if (!merged.cover && ext.cover) merged.cover = ext.cover;
      return merged;
    });
    return applyDeletionFilter(enriched);
  } else {
    const titleToIndex = new Map();
    const merged = [];
    let coverIdx = 0;
    const pushWithCover = (item) => {
      if (!item.cover) {
        const cover = getCoverUrlByIndex(coverIdx);
        merged.push({ ...item, cover });
        coverIdx++;
      } else {
        merged.push(item);
      }
      titleToIndex.set(item.title || '', merged.length - 1);
    };

    for (const t of baseTracks) {
      if (!t || !t.url) continue;
      const title = t.title || '';
      if (titleToIndex.has(title)) continue;
      pushWithCover(t);
    }

    for (const t of extra) {
      if (!t || !t.url) continue;
      const title = t.title || '';
      if (!titleToIndex.has(title)) {
        pushWithCover(t);
      } else {
        const idx = titleToIndex.get(title);
        const prev = merged[idx] || {};
        const enriched = { ...prev };
        if (!enriched.mvUrl && t.mvUrl) enriched.mvUrl = t.mvUrl;
        if (!enriched.cover && t.cover) enriched.cover = t.cover;
        merged[idx] = enriched;
      }
    }

    const patchedExtra = [];
    let extraCoverIdx = 0;
    for (const et of extra) {
      if (!et || !et.url) continue;
      if (!et.cover) {
        patchedExtra.push({
          ...et,
          cover: getCoverUrlByIndex(extraCoverIdx),
        });
        extraCoverIdx++;
      } else {
        patchedExtra.push(et);
      }
    }
    if (patchedExtra.length === extra.length) {
      setExtraTracks(patchedExtra);
    }

    return applyDeletionFilter(merged);
  }
};

export const preloadAssets = async (tracks, currentIndex = 0) => {
  try {
    const currentTrack = Array.isArray(tracks) ? tracks[currentIndex] || tracks[0] : null;
    await preloadCoverImages(currentTrack ? [currentTrack] : []);
  } catch (error) {
    console.warn('资源预加载失败:', error);
  }
};
