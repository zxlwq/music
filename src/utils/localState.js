/**
 * 本地状态统一入口：schema、校验写入、安全读取与复位。
 * 业务代码应通过本模块读写歌单/收藏相关 localStorage，避免散落 JSON.parse。
 */

/** @typedef {{ title?: string, url: string, cover?: string, mvUrl?: string }} LocalTrack */

export const LOCAL_KEYS = Object.freeze({
  favoriteUrls: 'favoriteUrls',
  deletedUrls: 'deletedUrls',
  deletedTitles: 'deletedTitles',
  overrideTracks: 'overrideTracks',
  extraTracks: 'extraTracks',
  showFavorites: 'ui.showFavorites',
  fontFamily: 'ui.fontFamily',
  bgUrl: 'ui.bgUrl',
  localBgFile: 'ui.localBgFile',
  skinId: 'ui.skinId',
  audioLoadMethod: 'ui.audioLoadMethod',
  customProxyUrl: 'ui.customProxyUrl',
  uploadTarget: 'ui.uploadTarget',
  audioAuraEnabled: 'ui.audioAuraEnabled',
  audioAuraIntensity: 'ui.audioAuraIntensity',
  audioCacheEnabled: 'audioCache.enabled',
  audioCacheConfig: 'audioCache.config',
  audioCacheTrackKeys: 'audioCache.cachedTrackKeys',
});

const PLAYLIST_KEYS = [
  LOCAL_KEYS.overrideTracks,
  LOCAL_KEYS.extraTracks,
  LOCAL_KEYS.deletedUrls,
  LOCAL_KEYS.deletedTitles,
];

function safeGetRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`[localState] 读取失败: ${key}`, e);
    return null;
  }
}

function safeSetRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`[localState] 写入失败: ${key}`, e);
    return false;
  }
}

function safeRemoveRaw(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    console.warn(`[localState] 删除失败: ${key}`, e);
    return false;
  }
}

/**
 * 解析 JSON；失败时可选回滚删除脏值。
 * @template T
 * @param {string} key
 * @param {(v: unknown) => T} validate
 * @param {T} fallback
 * @param {{ removeOnInvalid?: boolean }} [opts]
 * @returns {T}
 */
export function readJson(key, validate, fallback, opts = {}) {
  const raw = safeGetRaw(key);
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return validate(parsed);
  } catch (e) {
    console.warn(`[localState] JSON 无效，已忽略: ${key}`, e);
    if (opts.removeOnInvalid !== false) {
      safeRemoveRaw(key);
    }
    return fallback;
  }
}

/**
 * 校验后写入 JSON；校验失败不写。
 * @template T
 * @param {string} key
 * @param {unknown} value
 * @param {(v: unknown) => T} validate
 * @returns {boolean}
 */
export function writeJson(key, value, validate) {
  let clean;
  try {
    clean = validate(value);
  } catch (e) {
    console.warn(`[localState] 校验失败，拒绝写入: ${key}`, e);
    return false;
  }
  try {
    return safeSetRaw(key, JSON.stringify(clean));
  } catch (e) {
    console.warn(`[localState] 序列化失败: ${key}`, e);
    return false;
  }
}

export function readString(key, fallback = '') {
  const raw = safeGetRaw(key);
  return raw == null ? fallback : String(raw);
}

export function writeString(key, value) {
  return safeSetRaw(key, String(value ?? ''));
}

export function removeKey(key) {
  return safeRemoveRaw(key);
}

/** @param {unknown} v */
export function asStringList(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * @param {unknown} t
 * @returns {LocalTrack | null}
 */
export function sanitizeTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const rec = /** @type {Record<string, unknown>} */ (t);
  const url = typeof rec.url === 'string' ? rec.url.trim() : '';
  if (!url) return null;
  /** @type {LocalTrack} */
  const out = { url };
  if (typeof rec.title === 'string') out.title = rec.title;
  else if (rec.title != null) out.title = String(rec.title);
  if (typeof rec.cover === 'string' && rec.cover) out.cover = rec.cover;
  if (typeof rec.mvUrl === 'string' && rec.mvUrl) out.mvUrl = rec.mvUrl;
  return out;
}

/**
 * 曲目 URL 身份键：R2 / WebDAV 等「身份在查询串」的接口保留完整 URL；
 * 其它地址去掉 ?/# 缓存参数，避免同曲多份。
 * @param {string} url
 * @returns {string}
 */
export function trackUrlIdentity(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const noHash = raw.split('#')[0];
  try {
    const u = new URL(noHash, 'https://local.invalid');
    const path = u.pathname || '';
    if (path.includes('/api/r2') || path.includes('/api/webdav/stream')) {
      return `${path}${u.search || ''}`;
    }
    u.searchParams.delete('t');
    u.searchParams.delete('_');
    const q = u.searchParams.toString();
    return q ? `${path}?${q}` : path;
  } catch {
    if (noHash.includes('/api/r2?') || noHash.includes('/api/webdav/stream?')) {
      return noHash;
    }
    return noHash.split('?')[0];
  }
}

/**
 * 规范化曲目列表：必须含 url；按 {@link trackUrlIdentity} 去重。
 * @param {unknown} v
 * @returns {LocalTrack[]}
 */
export function asTrackList(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const item of v) {
    const t = sanitizeTrack(item);
    if (!t) continue;
    const dedupeKey = trackUrlIdentity(t.url);
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(t);
  }
  return out;
}

function asAudioCacheConfig(v) {
  if (!v || typeof v !== 'object') {
    return { maxCacheSize: 50, preloadCount: 1, preloadDelay: 1000 };
  }
  const num = (x, fb, min, max) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return fb;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  const out = {
    maxCacheSize: num(v.maxCacheSize, 50, 1, 200),
    preloadCount: num(v.preloadCount, 1, 1, 10),
    preloadDelay: num(v.preloadDelay, 1000, 100, 5000),
  };
  if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
  return out;
}

function asStringKeyList(v) {
  return asStringList(v).slice(-500);
}

// —— 歌单 / 收藏 ——

export function getFavoriteUrls() {
  return readJson(LOCAL_KEYS.favoriteUrls, asStringList, []);
}

export function setFavoriteUrls(urls) {
  return writeJson(LOCAL_KEYS.favoriteUrls, urls, asStringList);
}

export function getDeletedUrls() {
  return readJson(LOCAL_KEYS.deletedUrls, asStringList, []);
}

export function setDeletedUrls(urls) {
  return writeJson(LOCAL_KEYS.deletedUrls, urls, asStringList);
}

export function getDeletedTitles() {
  return readJson(LOCAL_KEYS.deletedTitles, asStringList, []);
}

export function setDeletedTitles(titles) {
  return writeJson(LOCAL_KEYS.deletedTitles, titles, asStringList);
}

export function getOverrideTracks() {
  return readJson(LOCAL_KEYS.overrideTracks, asTrackList, []);
}

export function setOverrideTracks(tracks) {
  return writeJson(LOCAL_KEYS.overrideTracks, tracks, asTrackList);
}

export function clearOverrideTracks() {
  return removeKey(LOCAL_KEYS.overrideTracks);
}

export function getExtraTracks() {
  return readJson(LOCAL_KEYS.extraTracks, asTrackList, []);
}

export function setExtraTracks(tracks) {
  return writeJson(LOCAL_KEYS.extraTracks, tracks, asTrackList);
}

export function getShowFavorites() {
  return readString(LOCAL_KEYS.showFavorites, 'false') === 'true';
}

export function setShowFavorites(show) {
  return writeString(LOCAL_KEYS.showFavorites, show ? 'true' : 'false');
}

/**
 * 写入后做轻量一致性：收藏去掉已删除 URL；extra/override 去掉已删除项。
 * 仅在内容变化时回写，避免每次 processTracks 无意义刷盘。
 */
export function reconcilePlaylistState() {
  const deleted = getDeletedUrls();
  const deletedSet = new Set();
  for (const u of deleted) {
    const id = trackUrlIdentity(u);
    if (id) deletedSet.add(id);
    deletedSet.add(String(u));
  }

  const isDeletedUrl = (url) => {
    if (!url) return false;
    if (deletedSet.has(url)) return true;
    const id = trackUrlIdentity(url);
    return Boolean(id && deletedSet.has(id));
  };

  const prevFav = getFavoriteUrls();
  const favorites = prevFav.filter((u) => !isDeletedUrl(u));
  if (favorites.length !== prevFav.length) setFavoriteUrls(favorites);

  const prevExtra = getExtraTracks();
  const extras = prevExtra.filter((t) => !isDeletedUrl(t.url));
  if (extras.length !== prevExtra.length) setExtraTracks(extras);

  const prevOverride = getOverrideTracks();
  const overrides = prevOverride.filter((t) => !isDeletedUrl(t.url));
  if (overrides.length !== prevOverride.length) setOverrideTracks(overrides);

  return {
    favorites: favorites.length !== prevFav.length ? favorites : prevFav,
    deletedUrls: deleted,
    extraTracks: extras.length !== prevExtra.length ? extras : prevExtra,
    overrideTracks: overrides.length !== prevOverride.length ? overrides : prevOverride,
  };
}

/** 复位本地歌单覆盖 / 删除标记（不影响收藏与 UI） */
export function resetPlaylistLocalState() {
  for (const key of PLAYLIST_KEYS) removeKey(key);
  return true;
}

/**
 * 更完整的本地状态复位入口。
 * @param {{ includeFavorites?: boolean, includeAudioCacheMeta?: boolean, includeUi?: boolean }} [opts]
 */
export function resetLocalAppState(opts = {}) {
  const { includeFavorites = false, includeAudioCacheMeta = false, includeUi = false } = opts;

  resetPlaylistLocalState();
  setShowFavorites(false);

  if (includeFavorites) {
    removeKey(LOCAL_KEYS.favoriteUrls);
  }

  if (includeAudioCacheMeta) {
    removeKey(LOCAL_KEYS.audioCacheTrackKeys);
  }

  if (includeUi) {
    removeKey(LOCAL_KEYS.fontFamily);
    removeKey(LOCAL_KEYS.bgUrl);
    removeKey(LOCAL_KEYS.localBgFile);
    removeKey(LOCAL_KEYS.audioLoadMethod);
    removeKey(LOCAL_KEYS.customProxyUrl);
    removeKey(LOCAL_KEYS.uploadTarget);
  }

  return true;
}

// —— UI 常用字段 ——

export function getUiString(key, fallback = '') {
  return readString(key, fallback);
}

export function setUiString(key, value) {
  return writeString(key, value);
}

export function getLocalBgFile() {
  return readJson(LOCAL_KEYS.localBgFile, (v) => (v && typeof v === 'object' ? v : null), null);
}

export function setLocalBgFile(fileObj) {
  if (fileObj == null) return removeKey(LOCAL_KEYS.localBgFile);
  if (typeof fileObj !== 'object') return false;
  return writeJson(LOCAL_KEYS.localBgFile, fileObj, (v) => v);
}

// —— 音频缓存元数据 ——

export function getAudioCacheTrackKeys() {
  return readJson(LOCAL_KEYS.audioCacheTrackKeys, asStringKeyList, []);
}

export function setAudioCacheTrackKeys(keys) {
  return writeJson(LOCAL_KEYS.audioCacheTrackKeys, keys, asStringKeyList);
}

export function getAudioCacheConfig() {
  return readJson(LOCAL_KEYS.audioCacheConfig, asAudioCacheConfig, asAudioCacheConfig(null));
}

export function setAudioCacheConfig(config) {
  return writeJson(LOCAL_KEYS.audioCacheConfig, config, asAudioCacheConfig);
}

export function getAudioCacheEnabled() {
  return readString(LOCAL_KEYS.audioCacheEnabled, 'false') === 'true';
}

export function setAudioCacheEnabled(enabled) {
  return writeString(LOCAL_KEYS.audioCacheEnabled, enabled ? 'true' : 'false');
}

/**
 * 从已删除列表中移除某 url / title（重新添加歌曲时用）。
 */
export function unmarkDeleted(url, title) {
  if (url) {
    const next = getDeletedUrls().filter((u) => u !== url);
    setDeletedUrls(next);
  }
  if (title) {
    const next = getDeletedTitles().filter((t) => t !== title);
    setDeletedTitles(next);
  }
}

/**
 * 标记删除：写入 deletedUrls，并从 extra / override 中移除。
 */
export function markDeletedByUrl(url, tracks) {
  if (!url || typeof url !== 'string') return;

  let currentTitle = '';
  try {
    const found = (tracks || []).find((t) => t && t.url === url);
    currentTitle = found?.title || '';
  } catch {
    /* ignore */
  }

  const extras = getExtraTracks().filter(
    (x) => x && x.url !== url && (!currentTitle || x.title !== currentTitle),
  );
  setExtraTracks(extras);

  const overrides = getOverrideTracks().filter(
    (x) => x && x.url !== url && (!currentTitle || x.title !== currentTitle),
  );
  setOverrideTracks(overrides);

  const deleted = getDeletedUrls();
  if (!deleted.includes(url)) {
    setDeletedUrls([...deleted, url]);
  }
  if (currentTitle) {
    const titles = getDeletedTitles();
    if (!titles.includes(currentTitle)) {
      setDeletedTitles([...titles, currentTitle]);
    }
  }

  const fav = getFavoriteUrls().filter((u) => u !== url);
  setFavoriteUrls(fav);
}

/**
 * 合并写入 extraTracks（按 title 去重合并字段）。
 * @param {LocalTrack[]} items
 */
export function persistExtraTracksMerge(items) {
  const extra = getExtraTracks();
  const titleToIndex = new Map();
  for (let i = 0; i < extra.length; i++) {
    const t = extra[i];
    if (t && t.title) titleToIndex.set(t.title, i);
  }
  for (const it of items || []) {
    if (!it || !it.title) continue;
    const idx = titleToIndex.get(it.title);
    if (typeof idx === 'number') {
      const prev = extra[idx] || { url: it.url };
      /** @type {LocalTrack} */
      const next = { ...prev, url: prev.url || it.url };
      if (it.url && !next.url) next.url = it.url;
      if (it.cover && !next.cover) next.cover = it.cover;
      if (it.mvUrl) next.mvUrl = it.mvUrl;
      if (!next.title) next.title = it.title;
      extra[idx] = next;
    } else if (it.url) {
      extra.push({
        title: it.title || '',
        url: it.url,
        ...(it.cover ? { cover: it.cover } : {}),
        ...(it.mvUrl ? { mvUrl: it.mvUrl } : {}),
      });
      titleToIndex.set(it.title, extra.length - 1);
    }
  }
  setExtraTracks(extra);
}
