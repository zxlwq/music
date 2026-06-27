import { preloadCoverImages } from './image';
import { getCoverUrlByIndex } from './covers';

const parseListPayload = (j) => {
  if (!j || !Array.isArray(j.tracks)) return null;
  return { tracks: j.tracks };
};

/** 从 SW 静态缓存桶读取预缓存的 music.json（请求带 ?t= 时 SW 可能未命中，此处兜底） */
async function tryReadMusicJsonFromStaticCaches() {
  if (typeof caches === 'undefined') return null;
  try {
    const names = await caches.keys();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!origin) return null;
    for (const name of names) {
      if (!/^music-static-/.test(name)) continue;
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

async function loadStaticManifestFast(headers) {
  try {
    const res = await fetch('/music.json', { cache: 'force-cache', headers });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/json/i.test(ct)) return null;
    const j = await res.json();
    return parseListPayload(j);
  } catch {
    return tryReadMusicJsonFromStaticCaches();
  }
}

/**
 * 并行请求 API 与静态 music.json：API 不可用时不必再等长超时，静态先到可先展示。
 */
export const loadManifest = async () => {
  try {
    const ts = Date.now();
    const headers = { accept: 'application/json' };
    const fastStatic = await loadStaticManifestFast(headers);
    if (fastStatic) return fastStatic;

    const staticP = (async () => {
      const res = await fetch('/music.json', { cache: 'force-cache', headers });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!/json/i.test(ct)) return null;
      const j = await res.json();
      return parseListPayload(j);
    })();

    const apiP = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2800);
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
        if (error.name === 'AbortError' || error.message.includes('fetch')) {
          console.warn('网络请求失败，可能是代理环境导致:', error.message);
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
        const res = await fetch('/music.json', { headers, cache: 'no-store' });
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
      try {
        const raw = localStorage.getItem('overrideTracks');
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr) && arr.length > 0) {
          console.warn('清单不可用，使用本地歌单 overrideTracks（离线或缓存未命中时）');
          data = { tracks: arr };
        }
      } catch {
        /* ignore */
      }
    }

    if (!data) {
      throw new Error('加载清单失败');
    }

    if (!fromApi && fromStatic) {
      console.log('服务端列表不可用，使用静态 music.json');
      console.info('当前使用静态歌单，如需实时更新请检查网络连接或代理设置');
    }

    return data;
  } catch (e) {
    throw new Error(e.message || '清单加载错误');
  }
};

export const processTracks = (data) => {
  const overrideRaw = localStorage.getItem('overrideTracks');
  let override = [];
  try {
    override = JSON.parse(overrideRaw || '[]');
  } catch {}

  const baseTracks = Array.isArray(data.tracks) ? data.tracks : [];
  const extraRaw = localStorage.getItem('extraTracks');
  let extra = [];
  try {
    extra = JSON.parse(extraRaw || '[]');
  } catch {}

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
      const delRaw = localStorage.getItem('deletedUrls');
      const del = Array.isArray(JSON.parse(delRaw || '[]')) ? JSON.parse(delRaw || '[]') : [];
      if (!Array.isArray(list) || !list.length || !del.length) return list;
      const present = new Set((list || []).map((it) => it?.url).filter(Boolean));
      const pruned = del.filter((u) => !present.has(u));
      if (pruned.length !== del.length) {
        localStorage.setItem('deletedUrls', JSON.stringify(pruned));
      }
      if (!pruned.length) return list;
      const prunedSet = new Set(pruned);
      return list.filter((it) => !prunedSet.has(it?.url));
    } catch {
      return list;
    }
  };

  if (Array.isArray(override) && override.length) {
    const extraRaw2 = localStorage.getItem('extraTracks');
    let extra2 = [];
    try {
      extra2 = JSON.parse(extraRaw2 || '[]');
    } catch {}
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
      localStorage.setItem('extraTracks', JSON.stringify(patchedExtra));
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
