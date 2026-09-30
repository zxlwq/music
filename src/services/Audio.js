import { AUDIO_CACHE_BUCKET } from '../constants/Bucket';
import {
  getAudioCacheEnabled,
  getAudioCacheTrackKeys,
  LOCAL_KEYS,
  removeKey,
  setAudioCacheTrackKeys,
} from '../utils/localState';

/** 预加载常见的瞬时网络/配额错误，降噪与重试用 */
function isTransientAudioCacheError(err) {
  if (!err) return false;
  const name = err.name || '';
  const msg = String(err.message || err);
  return (
    name === 'AbortError' ||
    name === 'NetworkError' ||
    name === 'TypeError' ||
    /Failed to fetch|network error|QuotaExceeded|Cache\.put|音频拉取失败:\s*(408|425|429|5\d\d)/i.test(
      msg,
    )
  );
}

function logAudioCacheIssue(label, err) {
  if (isTransientAudioCacheError(err)) {
    console.debug(`[音频缓存] ${label}:`, err?.message || err);
    return;
  }
  console.warn(`[音频缓存] ${label}:`, err);
}

class AudioCacheService {
  constructor() {
    this.cache = new Map();
    this.preloadQueue = [];
    this.maxCacheSize = 50;
    this.maxPreloadSize = 5;
    this.cacheSize = 0;
    this.isPreloading = false;
    this.preloadTimeout = null;
    this.preloadStartTime = 0;
    this.preloadCount = 0;
    /** `startPreloading` 运行期间又有新任务入队时置位，结束后串联下一轮 */
    this._preloadContinueRequested = false;
    /** `preloadUntilFull` 传入的歌单与起点，队列抽空后用于立刻续扫（替代页面定时器） */
    this._fillTracks = null;
    this._fillStartIndex = 0;
    /** 空闲续扫次数上限，避免单曲反复失败时死循环 */
    this._idleFillBudget = 150;
    /** 与 `public/sw.js` 中 AUDIO_CACHE 相同，整文件缓存与 SW 拦截的请求共用一桶 */
    this.cacheStoreName = AUDIO_CACHE_BUCKET;
    /** 合并同曲并发检查/恢复，避免重复 blob 解码占满主线程 */
    this._hasCachedInflight = new Map();
    this._restoreInflight = new Map();
    this._cacheUpdatedTimer = null;
    /**
     * 播放/切歌加载优先：为 true 时中止并挂起预加载整文件 fetch，把带宽让给 <audio>
     * 当前曲的 cacheAudioWithProgress（缓冲条补全）不受此开关拦截
     */
    this._playbackPriority = false;
    /** 当前预加载队列里那一次 cacheAudio 的 AbortController */
    this._preloadFetchAbort = null;
  }

  resetIdleFillBudget() {
    this._idleFillBudget = 150;
  }

  /** @returns {boolean} */
  isPlaybackPriority() {
    return this._playbackPriority;
  }

  /**
   * 播放优先闸门：开启时中止进行中的预加载下载；关闭后若队列非空则继续预加载。
   * @param {boolean} active
   */
  setPlaybackPriority(active) {
    const next = !!active;
    if (this._playbackPriority === next) return;
    this._playbackPriority = next;
    if (next) {
      try {
        this._preloadFetchAbort?.abort();
      } catch {
        /* ignore */
      }
      this._preloadFetchAbort = null;
      return;
    }
    if (getAudioCacheEnabled() && this.preloadQueue.length > 0 && !this.isPreloading) {
      void this.startPreloading();
    }
  }

  /** 等待播放优先结束（预加载循环在拉流前调用） */
  async waitWhilePlaybackPriority() {
    while (this._playbackPriority) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  getAudioUrl(track) {
    if (!track || !track.url) return '';
    const customProxyUrl = localStorage.getItem('ui.customProxyUrl') || '';
    if (customProxyUrl) {
      return `${customProxyUrl}?url=${encodeURIComponent(track.url)}`;
    }

    if (track.url.includes('github.com') || track.url.includes('raw.githubusercontent.com')) {
      return `/api/audio?url=${encodeURIComponent(track.url)}`;
    }

    try {
      const url = new URL(track.url, window.location.origin);
      const currentOrigin = window.location.origin;

      if (url.origin !== currentOrigin && url.protocol.startsWith('http')) {
        const pathname = url.pathname;
        if (pathname) {
          const key = decodeURIComponent(pathname.replace(/^\/+/, ''));
          if (key) {
            return `/api/r2?key=${encodeURIComponent(key)}`;
          }
        }
      }
    } catch {}

    return track.url;
  }

  async preloadAudio(track, priority = 'normal') {
    if (!track || !track.url) return null;

    // const audioUrl = this.getAudioUrl(track) // 保留以备将来使用
    const cacheKey = this.getCacheKey(track);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    this.addToPreloadQueue(track, priority);

    this.startPreloading();

    return null;
  }

  getCachedAudio(track) {
    if (!track || !track.url) return null;

    const cacheKey = this.getCacheKey(track);
    const entry = this.cache.get(cacheKey);
    if (entry) {
      const audio = entry?.audio || entry;
      if (audio) audio.lastUsed = Date.now();
      return audio;
    }

    // 内存中没有，但可能 Cache Storage 中有，返回 null 让调用方处理
    // 调用方应该尝试从 Cache Storage 恢复或触发预加载
    return null;
  }

  async getCachedAudioAsync(track, audioUrls = []) {
    if (!track || !track.url) return null;

    const cacheKey = this.getCacheKey(track);
    const entry = this.cache.get(cacheKey);
    if (entry) {
      const audio = entry?.audio || entry;
      if (audio) audio.lastUsed = Date.now();
      return audio;
    }

    if (this._restoreInflight.has(cacheKey)) {
      return this._restoreInflight.get(cacheKey);
    }

    const restorePromise = this._restoreFromCacheStorage(track, audioUrls, cacheKey);
    this._restoreInflight.set(cacheKey, restorePromise);
    try {
      return await restorePromise;
    } finally {
      this._restoreInflight.delete(cacheKey);
    }
  }

  async _restoreFromCacheStorage(track, audioUrls, cacheKey) {
    const audioUrlCandidates = this.getAudioUrlCandidates(track, audioUrls);
    if (typeof caches === 'undefined') return null;

    try {
      const cache = await caches.open(this.cacheStoreName);
      for (const audioUrl of audioUrlCandidates) {
        const cachedResponse = await cache.match(audioUrl);
        if (!cachedResponse) continue;

        const blob = await cachedResponse.blob();
        const objectUrl = URL.createObjectURL(blob);

        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';
        audio.src = objectUrl;
        audio.lastUsed = Date.now();

        this.setCache(cacheKey, { audio, objectUrl, source: audioUrl });
        return audio;
      }
    } catch (err) {
      console.warn('从 Cache Storage 恢复音频失败:', err);
    }

    return null;
  }

  async hasCachedAudio(track, audioUrls = []) {
    if (!track || !track.url || typeof caches === 'undefined') return false;

    const cacheKey = this.getCacheKey(track);
    if (this.cache.has(cacheKey)) return true;

    if (this._hasCachedInflight.has(cacheKey)) {
      return this._hasCachedInflight.get(cacheKey);
    }

    const checkPromise = this._probePersistedCache(track, audioUrls, cacheKey);
    this._hasCachedInflight.set(cacheKey, checkPromise);
    try {
      return await checkPromise;
    } finally {
      this._hasCachedInflight.delete(cacheKey);
    }
  }

  async _probePersistedCache(track, audioUrls, cacheKey) {
    try {
      const cache = await caches.open(this.cacheStoreName);
      const audioUrlCandidates = this.getAudioUrlCandidates(track, audioUrls);
      for (const audioUrl of audioUrlCandidates) {
        const cachedResponse = await cache.match(audioUrl);
        if (cachedResponse?.ok) {
          this.rememberCachedTrackKey(cacheKey);
          return true;
        }
      }
    } catch (err) {
      logAudioCacheIssue('检查失败', err);
    }

    return false;
  }

  async cacheAudio(track) {
    if (!track || !track.url) return null;

    const audioUrl = this.getAudioUrl(track);
    const cacheKey = this.getCacheKey(track);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 先尝试从 Cache Storage 读已有离线副本
    let objectUrl = null;
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(this.cacheStoreName);
        const cachedResponse = await cache.match(audioUrl);
        if (cachedResponse) {
          const blob = await cachedResponse.blob();
          objectUrl = URL.createObjectURL(blob);
        }
      } catch (err) {
        logAudioCacheIssue('读取失败', err);
      }
    }

    if (objectUrl) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = objectUrl;
      audio.lastUsed = Date.now();
      this.setCache(cacheKey, { audio, objectUrl, source: audioUrl });
      return audio;
    }

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.waitWhilePlaybackPriority();
        if (!getAudioCacheEnabled()) return null;

        const controller = new AbortController();
        this._preloadFetchAbort = controller;
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        let resp;
        try {
          resp = await fetch(audioUrl, {
            redirect: 'follow',
            signal: controller.signal,
            cache: 'no-store',
          });
        } finally {
          clearTimeout(timeoutId);
          if (this._preloadFetchAbort === controller) {
            this._preloadFetchAbort = null;
          }
        }

        if (!resp.ok || !resp.body) {
          throw new Error(`音频拉取失败: ${resp.status}`);
        }

        const contentType = resp.headers.get('content-type') || '';
        if (!/^audio\//i.test(contentType)) {
          throw new Error(`Unsupported content type: ${contentType}`);
        }

        const contentLengthHeader = resp.headers.get('content-length');
        const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
        if (contentLengthHeader && Number.isFinite(contentLength) && contentLength <= 0) {
          throw new Error('音频文件大小为空');
        }

        if (typeof caches !== 'undefined') {
          try {
            const cache = await caches.open(this.cacheStoreName);
            await cache.put(audioUrl, resp.clone());
          } catch (err) {
            logAudioCacheIssue('写入失败（仍可内存播放）', err);
          }
        }

        const blob = await resp.blob();
        if (!blob || blob.size === 0) {
          throw new Error('拉取到的音频数据为空');
        }
        objectUrl = URL.createObjectURL(blob);

        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';
        audio.src = objectUrl;
        audio.lastUsed = Date.now();
        this.setCache(cacheKey, { audio, objectUrl, source: audioUrl });
        return audio;
      } catch (error) {
        if (error?.name === 'AbortError' && this._playbackPriority) {
          // 播放优先主动中止：曲目仍留在队列外，由调用方/续扫再入队
          return null;
        }
        const canRetry = attempt < maxAttempts - 1 && isTransientAudioCacheError(error);
        if (canRetry) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        logAudioCacheIssue('预加载跳过', error);
        return null;
      }
    }

    return null;
  }

  /**
   * 带下载进度的整文件缓存（供播放中缓冲条在 media 水位停滞后继续前进）
   * onProgress(ratio 0~1 | null)
   * @param {string} [preferredUrl] 与播放器实际 src 一致的地址，避免代理路径不一致
   * @param {number} [estimatedBytes] 可选预估字节数，用于进度分母
   */
  async cacheAudioWithProgress(track, onProgress, externalSignal, preferredUrl, estimatedBytes) {
    if (!track || !track.url) return null;

    const audioUrl = preferredUrl || this.getAudioUrl(track);
    const cacheKey = this.getCacheKey(track);

    if (this.cache.has(cacheKey)) {
      onProgress?.(1);
      return this.cache.get(cacheKey);
    }

    try {
      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(this.cacheStoreName);
          const cachedResponse = await cache.match(audioUrl);
          if (cachedResponse) {
            const blob = await cachedResponse.blob();
            const objectUrl = URL.createObjectURL(blob);
            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';
            audio.src = objectUrl;
            audio.lastUsed = Date.now();
            this.setCache(cacheKey, { audio, objectUrl, source: audioUrl });
            onProgress?.(1);
            return this.cache.get(cacheKey);
          }
        } catch (err) {
          logAudioCacheIssue('带进度读取失败', err);
        }
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', onAbort, { once: true });
        }
      }
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      let resp;
      try {
        resp = await fetch(audioUrl, {
          redirect: 'follow',
          signal: controller.signal,
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timeoutId);
        if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      }

      if (!resp.ok || !resp.body) {
        throw new Error(`音频拉取失败: ${resp.status}`);
      }

      const contentType = resp.headers.get('content-type') || '';
      // 代理/部分源可能不带 audio/*，只要是流式 body 就继续（避免补进度直接失败）
      if (contentType && /^(text\/|application\/json)/i.test(contentType)) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const total = Number(resp.headers.get('content-length')) || 0;
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      const fallbackTotal =
        Number.isFinite(estimatedBytes) && estimatedBytes > 0 ? estimatedBytes : 16000 * 240;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        const denom = total > 0 ? total : Math.max(fallbackTotal, received + 256 * 1024);
        onProgress?.(Math.min(0.99, received / denom));
      }

      const blob = new Blob(chunks, {
        type: contentType && /^audio\//i.test(contentType) ? contentType : 'audio/mpeg',
      });
      if (!blob.size) throw new Error('拉取到的音频数据为空');

      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(this.cacheStoreName);
          const headers = new Headers({
            'Content-Type': blob.type,
            'Content-Length': String(blob.size),
          });
          await cache.put(audioUrl, new Response(blob, { status: 200, headers }));
        } catch (err) {
          logAudioCacheIssue('带进度写入失败', err);
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = objectUrl;
      audio.lastUsed = Date.now();
      this.setCache(cacheKey, { audio, objectUrl, source: audioUrl });
      onProgress?.(1);
      return this.cache.get(cacheKey);
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      logAudioCacheIssue('带进度预加载跳过', error);
      return null;
    }
  }

  async preloadNext(tracks, currentIndex) {
    if (!tracks || !Array.isArray(tracks)) return;

    const nextIndex = (currentIndex + 1) % tracks.length;
    const nextTrack = tracks[nextIndex];

    if (nextTrack) {
      await this.preloadAudio(nextTrack, 'high');
    }
  }

  async preloadPrev(tracks, currentIndex) {
    if (!tracks || !Array.isArray(tracks)) return;

    const prevIndex = (currentIndex - 1 + tracks.length) % tracks.length;
    const prevTrack = tracks[prevIndex];

    if (prevTrack) {
      await this.preloadAudio(prevTrack, 'high');
    }
  }

  async preloadBatch(tracks, startIndex, count = 1) {
    if (!tracks || !Array.isArray(tracks)) return;

    const preloadPromises = [];

    for (let i = 0; i < count; i++) {
      const index = (startIndex + i) % tracks.length;
      const track = tracks[index];

      if (track) {
        // 检查是否已经缓存，避免重复预加载
        const cacheKey = this.getCacheKey(track);
        if (!this.cache.has(cacheKey)) {
          preloadPromises.push(this.preloadAudio(track, 'normal'));
        }
      }
    }

    await Promise.allSettled(preloadPromises);
  }

  async preloadUntilFull(tracks, startIndex) {
    if (!tracks || !Array.isArray(tracks)) return;
    if (!getAudioCacheEnabled()) return;

    this._fillTracks = tracks;
    this._fillStartIndex = startIndex;

    let currentIndex = startIndex;
    let addedCount = 0;
    let restoredCount = 0;
    let stepsWithoutProgress = 0;
    const maxStepsWithoutProgress = Math.max(tracks.length, 1) + 1;
    const maxAttempts = Math.min(this.maxCacheSize * 4, Math.max(80, tracks.length * 3));

    const cacheStoreCheck =
      typeof caches !== 'undefined'
        ? await caches.open(this.cacheStoreName).catch(() => null)
        : null;

    while (this.cache.size < this.maxCacheSize && addedCount + restoredCount < maxAttempts) {
      if (!getAudioCacheEnabled()) {
        this.stopPreloading();
        return;
      }
      const track = tracks[currentIndex];
      let progressed = false;

      if (track) {
        const cacheKey = this.getCacheKey(track);
        if (!this.cache.has(cacheKey)) {
          let persisted = this.hasCachedTrackKey(cacheKey);

          if (!persisted && cacheStoreCheck) {
            try {
              const audioUrl = this.getAudioUrl(track);
              const cachedResponse = await cacheStoreCheck.match(audioUrl);
              if (cachedResponse) {
                persisted = true;
                this.rememberCachedTrackKey(cacheKey);
              }
            } catch {
              // 检查失败，继续预加载
            }
          }

          if (persisted) {
            await this.getCachedAudioAsync(track).catch(() => {});
            restoredCount++;
            progressed = true;
          } else if (this.addToPreloadQueue(track, 'normal')) {
            addedCount++;
            progressed = true;
          }
        }
      }

      currentIndex = (currentIndex + 1) % tracks.length;

      if (!progressed) {
        stepsWithoutProgress++;
        if (stepsWithoutProgress >= maxStepsWithoutProgress) break;
      } else {
        stepsWithoutProgress = 0;
      }

      if ((addedCount + restoredCount) % 3 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (this.preloadQueue.length > 0) {
      this.startPreloading();
    }
  }

  clearCache() {
    this.stopPreloading();
    this.cache.forEach((entry) => {
      const audio = entry?.audio || entry;
      if (audio && audio.src) {
        audio.src = '';
        audio.load();
      }
      if (entry?.objectUrl) {
        try {
          URL.revokeObjectURL(entry.objectUrl);
        } catch {}
      }
    });
    this.cache.clear();
    // keep counter consistent with actual Map size
    this.cacheSize = this.cache.size;

    if ('caches' in window) {
      caches.keys().then((cacheNames) => {
        cacheNames.forEach((cacheName) => {
          if (cacheName === AUDIO_CACHE_BUCKET || cacheName.includes('audio-cache')) {
            caches.delete(cacheName);
          }
        });
      });
    }

    try {
      removeKey(LOCAL_KEYS.audioCacheTrackKeys);
    } catch {}
  }

  /** 立即停止填充/预加载队列，并刷新可观测状态 */
  stopPreloading() {
    try {
      this._preloadFetchAbort?.abort();
    } catch {
      /* ignore */
    }
    this._preloadFetchAbort = null;
    this.preloadQueue = [];
    this._fillTracks = null;
    this._fillStartIndex = 0;
    this._preloadContinueRequested = false;
    this._idleFillBudget = 0;
    this.isPreloading = false;
    this.preloadCount = 0;
    this.preloadStartTime = 0;
    if (this.preloadTimeout) {
      clearTimeout(this.preloadTimeout);
      this.preloadTimeout = null;
    }
  }

  getCacheStats() {
    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      preloadQueueLength: this.preloadQueue.length,
      isPreloading: this.isPreloading,
      preloadCount: this.preloadCount,
      preloadStartTime: this.preloadStartTime,
    };
  }

  /** Cache Storage 中本桶的请求条数（刷新页面后仍在；可能与内存条数不一致） */
  async countPersistedCacheRequests() {
    if (typeof caches === 'undefined') return 0;
    try {
      const cache = await caches.open(this.cacheStoreName);
      const keys = await cache.keys();
      return keys.length;
    } catch {
      return 0;
    }
  }

  /** 当前歌单中已有 Cache Storage 离线副本的曲目数（按曲目计，非原始请求条数） */
  async countPersistedCacheForTracks(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return 0;
    if (typeof caches === 'undefined') return 0;

    try {
      const cache = await caches.open(this.cacheStoreName);
      const requests = await cache.keys();
      if (!requests.length) return 0;

      const cachedUrls = requests.map((request) => request.url);
      const matchesPersisted = (candidate) => {
        if (!candidate) return false;
        if (cachedUrls.includes(candidate)) return true;

        const absolute = (() => {
          try {
            return new URL(candidate, window.location.origin).href;
          } catch {
            return candidate;
          }
        })();
        if (cachedUrls.includes(absolute)) return true;

        const tokens = this.getAudioCacheMatchTokens(candidate);
        return cachedUrls.some((cachedUrl) =>
          tokens.some((token) => token && cachedUrl.includes(token)),
        );
      };

      let count = 0;
      for (const track of tracks) {
        if (!track?.url) continue;
        const candidates = this.getAudioUrlCandidates(track);
        if (candidates.some(matchesPersisted)) count += 1;
      }
      return count;
    } catch {
      return 0;
    }
  }

  /** 按当前歌单统计内存缓存条目数 */
  getCacheStatsForTracks(tracks) {
    const base = this.getCacheStats();
    if (!Array.isArray(tracks) || !tracks.length) return base;

    const trackKeys = new Set(
      tracks.filter((track) => track?.url).map((track) => this.getCacheKey(track)),
    );
    let cacheSize = 0;
    for (const key of this.cache.keys()) {
      if (trackKeys.has(key)) cacheSize += 1;
    }
    return { ...base, cacheSize };
  }

  setMaxCacheSize(size) {
    this.maxCacheSize = Math.max(1, size);
    this.cleanupCache();
  }

  getCacheKey(track) {
    return `${track.url}_${track.title || ''}`;
  }

  getAudioUrlCandidates(track, audioUrls = []) {
    if (!track?.url) return [];

    const candidates = [
      ...audioUrls,
      this.getAudioUrl(track),
      track.url,
      `/api/audio?url=${encodeURIComponent(track.url)}`,
    ];

    try {
      const url = new URL(track.url, window.location.origin);
      if (url.origin !== window.location.origin && url.protocol.startsWith('http')) {
        const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        if (key) candidates.push(`/api/r2?key=${encodeURIComponent(key)}`);
      }
    } catch {}

    return [...new Set(candidates.filter(Boolean))];
  }

  getAudioCacheIndex() {
    return getAudioCacheTrackKeys();
  }

  hasCachedTrackKey(key) {
    if (!key) return false;
    return this.getAudioCacheIndex().includes(key);
  }

  rememberCachedTrackKey(key) {
    if (!key) return;

    try {
      const keys = this.getAudioCacheIndex();
      if (keys.includes(key)) return;
      keys.push(key);
      setAudioCacheTrackKeys(keys.slice(-500));
    } catch {}
  }

  getAudioCacheMatchTokens(value) {
    const tokens = new Set();
    if (!value) return [];

    const add = (token) => {
      if (token) tokens.add(token);
    };

    add(value);

    try {
      const url = new URL(value, window.location.origin);
      add(url.href);
      add(`${url.pathname}${url.search}`);

      const proxiedUrl = url.searchParams.get('url');
      if (proxiedUrl) {
        add(proxiedUrl);
        add(decodeURIComponent(proxiedUrl));
      }

      const key = url.searchParams.get('key');
      if (key) {
        add(key);
        add(decodeURIComponent(key));
      }
    } catch {}

    return [...tokens];
  }

  /**
   * @returns {boolean} 是否新加入队列（已在队列中的相同 URL 返回 false）
   */
  addToPreloadQueue(track, priority) {
    const existing = this.preloadQueue.find((item) => item.track.url === track.url);
    if (existing) return false;

    this.preloadQueue.push({
      track,
      priority,
      timestamp: Date.now(),
    });

    this.preloadQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    return true;
  }

  async startPreloading() {
    if (!getAudioCacheEnabled()) {
      this.stopPreloading();
      return;
    }
    if (this.preloadQueue.length === 0) return;

    if (this.isPreloading) {
      this._preloadContinueRequested = true;
      return;
    }

    this.isPreloading = true;
    this.preloadStartTime = Date.now();
    this.preloadCount = 0;

    try {
      while (this.preloadQueue.length > 0 && this.cache.size < this.maxCacheSize) {
        if (!getAudioCacheEnabled()) {
          this.preloadQueue = [];
          break;
        }
        await this.waitWhilePlaybackPriority();
        if (!getAudioCacheEnabled()) {
          this.preloadQueue = [];
          break;
        }
        if (this.preloadQueue.length === 0) break;
        const { track } = this.preloadQueue.shift();
        this.preloadCount++;
        const cached = await this.cacheAudio(track);
        // 播放优先中止时把曲目重新入队，恢复后继续
        if (!cached && this._playbackPriority && track) {
          this.addToPreloadQueue(track, 'high');
          break;
        }
      }
    } catch (error) {
      console.warn('预加载失败:', error);
    } finally {
      if (!getAudioCacheEnabled()) {
        this.stopPreloading();
      } else {
        const preloadDuration = Date.now() - this.preloadStartTime;
        const minDisplayTime = 3000;
        const remainingTime = Math.max(0, minDisplayTime - preloadDuration);

        const finishCycle = () => {
          if (!getAudioCacheEnabled()) {
            this.stopPreloading();
            return;
          }
          this.isPreloading = false;
          this.preloadCount = 0;
          const needContinue =
            this._preloadContinueRequested ||
            (this.preloadQueue.length > 0 && this.cache.size < this.maxCacheSize);
          this._preloadContinueRequested = false;
          if (needContinue && this.preloadQueue.length > 0 && this.cache.size < this.maxCacheSize) {
            void this.startPreloading();
            return;
          }
          // 队列已空且仍低于上限：立刻再扫一轮歌单补队列（不依赖页面定时器）
          if (
            this.cache.size < this.maxCacheSize &&
            this.preloadQueue.length === 0 &&
            Array.isArray(this._fillTracks) &&
            this._fillTracks.length > 0 &&
            this._idleFillBudget > 0
          ) {
            this._idleFillBudget -= 1;
            queueMicrotask(() => {
              void this.preloadUntilFull(this._fillTracks, this._fillStartIndex);
            });
          }
        };

        if (remainingTime > 0) {
          setTimeout(finishCycle, remainingTime);
        } else {
          queueMicrotask(finishCycle);
        }
      }
    }
  }

  setCache(key, audio) {
    const isNewEntry = !this.cache.has(key);
    if (isNewEntry && this.cache.size >= this.maxCacheSize) {
      this.cleanupCache();
    }

    if (!isNewEntry) {
      const existing = this.cache.get(key);
      if (existing?.objectUrl && existing.objectUrl !== audio?.objectUrl) {
        try {
          URL.revokeObjectURL(existing.objectUrl);
        } catch {}
      }
    }

    this.cache.set(key, audio);
    // keep explicit counter consistent with Map size
    this.cacheSize = this.cache.size;
    this.rememberCachedTrackKey(key);

    if (typeof window !== 'undefined') {
      const detail = {
        key,
        source: audio?.source || '',
      };
      if (this._cacheUpdatedTimer) {
        clearTimeout(this._cacheUpdatedTimer);
      }
      this._cacheUpdatedTimer = setTimeout(() => {
        this._cacheUpdatedTimer = null;
        window.dispatchEvent(new CustomEvent('audio-cache-updated', { detail }));
      }, 250);
    }
  }

  cleanupCache() {
    if (this.cache.size <= this.maxCacheSize) return;

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => {
      const aEntry = a[1];
      const bEntry = b[1];
      const aAudio = aEntry?.audio || aEntry;
      const bAudio = bEntry?.audio || bEntry;
      const aTime = aAudio?.lastUsed || 0;
      const bTime = bAudio?.lastUsed || 0;
      return aTime - bTime;
    });
    const toDelete = entries.slice(0, this.cache.size - this.maxCacheSize);
    toDelete.forEach(([key, entry]) => {
      const audio = entry?.audio || entry;
      if (audio && audio.src) {
        audio.src = '';
        audio.load();
      }
      if (entry?.objectUrl) {
        try {
          URL.revokeObjectURL(entry.objectUrl);
        } catch {}
      }
      this.cache.delete(key);
      // keep cacheSize consistent with Map
      this.cacheSize = this.cache.size;
    });
  }
}

const audioCacheService = new AudioCacheService();

export default audioCacheService;
