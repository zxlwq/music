// dist 构建后由 scripts/precache.mjs 替换 CACHE_VERSION、BUILD_ASSET_PRECACHE 与 COVER_PRECACHE
const CACHE_VERSION = 'v1-dev'; // SW-AUTO-CACHEV
const BUILD_ASSET_PRECACHE = []; // SW-AUTO-PRECACHE
const COVER_PRECACHE = []; // SW-AUTO-COVER-PRECACHE

const STATIC_CACHE = `music-static-${CACHE_VERSION}`;
/** 与 src/constants/Bucket.js 中 AUDIO_CACHE_BUCKET 保持一致（不按 SW 版本轮换，便于主线程与 SW 共用） */
const AUDIO_CACHE = 'music-player-audio';
const API_CACHE = `api-cache-${CACHE_VERSION}`;

/** 壳层与清单：统一无查询串键，避免 `?t=` 与预缓存条目互相 miss / 混用 */
const SHELL_PATHS = new Set(['/', '/index.html', '/music.json', '/webmanifest', '/sw.js']);

/** 离线 API 缓存最长可用时间；超时则视为过期（在线仍走网络优先） */
const API_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SW_CACHED_AT_HEADER = 'x-sw-cached-at';

const STATIC_RESOURCES = ['/', '/index.html', '/webmanifest', '/music.json', '/sw.js'];

const IMAGE_RESOURCES = [
  '/favicon.ico',
  '/images/background.webp',
  '/images/cd.webp',
  '/images/cd_tou.webp',
];

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];

function isAudioRequest(url) {
  return (
    AUDIO_EXTENSIONS.some((ext) => url.pathname.toLowerCase().endsWith(ext)) ||
    url.pathname.startsWith('/api/audio') ||
    url.pathname.startsWith('/api/webdav/stream') ||
    url.pathname.startsWith('/music/')
  );
}

function isShellPath(pathname) {
  return SHELL_PATHS.has(pathname);
}

/** 版本化桶内的规范键：去掉 search/hash，避免旧 ?t= 与新响应并存 */
function canonicalRequest(url, method = 'GET') {
  const path = url.pathname || '/';
  return new Request(`${url.origin}${path}`, { method });
}

/** 歌单接口常带 `?t=` 防 HTTP 缓存；SW 内用无查询串 URL 作缓存键 */
function isMusicListApiPath(pathname) {
  return pathname === '/api/music/list';
}

function musicListCacheKeyRequest(url) {
  return new Request(`${url.origin}/api/music/list`, { method: 'GET' });
}

function apiCacheKeyRequest(request, url) {
  if (isMusicListApiPath(url.pathname)) return musicListCacheKeyRequest(url);
  return request;
}

async function matchApiCache(cache, request, url) {
  return cache.match(apiCacheKeyRequest(request, url));
}

function stampResponseForCache(response) {
  const headers = new Headers(response.headers);
  headers.set(SW_CACHED_AT_HEADER, String(Date.now()));
  return response.arrayBuffer().then(
    (buf) =>
      new Response(buf, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
  );
}

function isApiCacheFresh(response) {
  if (!response) return false;
  const raw = response.headers.get(SW_CACHED_AT_HEADER);
  if (!raw) return true;
  const at = Number(raw);
  if (!Number.isFinite(at)) return true;
  return Date.now() - at <= API_CACHE_MAX_AGE_MS;
}

async function putApiCacheEntry(cache, request, responseClone, url) {
  const keyRequest = apiCacheKeyRequest(request, url);
  const stamped = await stampResponseForCache(responseClone);
  return cache.put(keyRequest, stamped);
}

function quietCachePut(promise) {
  return Promise.resolve(promise).catch((err) => {
    console.debug('[sw] 写入缓存失败（可忽略）:', err?.message || err);
  });
}

/** Vite 构建产物：缓存优先，避免离线时网络优先导致白屏 */
async function cacheFirstAsset(request, cacheName, scheduleWrite) {
  const cache = await caches.open(cacheName);
  let res = await cache.match(request);
  if (res) return res;
  try {
    res = await fetch(request);
    if (res && res.ok) {
      const toStore = res.clone();
      if (typeof scheduleWrite === 'function') {
        scheduleWrite(quietCachePut(cache.put(request, toStore)));
      } else {
        await quietCachePut(cache.put(request, toStore));
      }
    }
    return res;
  } catch (e) {
    console.warn('[sw] cacheFirstAsset 失败:', request.url, e);
    return new Response(
      `当前处于离线状态，且该资源尚未缓存在本机。\n请联网后重试；若曾访问过该页面，可先返回已打开过的页面再试。\n地址：${request.url}`,
      {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      },
    );
  }
}

/** 壳层 / 清单：网络优先，写入规范键；失败再读当前版本桶 */
async function networkFirstShell(request, url, scheduleWrite) {
  const cache = await caches.open(STATIC_CACHE);
  const key = isShellPath(url.pathname) ? canonicalRequest(url) : request;

  try {
    const fetchResponse = await fetch(request, { cache: 'no-store' });
    if (fetchResponse.ok) {
      const toStore = fetchResponse.clone();
      if (typeof scheduleWrite === 'function') {
        scheduleWrite(quietCachePut(cache.put(key, toStore)));
      } else {
        await quietCachePut(cache.put(key, toStore));
      }
    }
    return fetchResponse;
  } catch {
    let cached = await cache.match(key);
    if (!cached && url.pathname === '/') {
      cached = await cache.match(canonicalRequest(new URL('/index.html', url.origin)));
    }
    if (cached) return cached;
    if (request.destination === 'document') {
      const fallback = await cache.match(canonicalRequest(new URL('/index.html', url.origin)));
      if (fallback) return fallback;
    }
    return new Response('资源不可用：当前离线且未命中本地缓存。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// 处理 Range 请求
async function handleRangeRequest(request, cachedResponse) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader || !cachedResponse) {
    return cachedResponse;
  }

  try {
    const blob = await cachedResponse.blob();
    const totalLength = blob.size;

    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!rangeMatch) {
      return cachedResponse;
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : totalLength - 1;

    if (start >= totalLength || end >= totalLength || start > end) {
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: {
          'Content-Range': `bytes */${totalLength}`,
        },
      });
    }

    const slicedBlob = blob.slice(start, end + 1);
    const slicedArrayBuffer = await slicedBlob.arrayBuffer();

    return new Response(slicedArrayBuffer, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Range': `bytes ${start}-${end}/${totalLength}`,
        'Content-Length': slicedArrayBuffer.byteLength.toString(),
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.warn('Range 请求处理失败:', error);
    return cachedResponse;
  }
}

async function deleteOutdatedCaches() {
  const keep = new Set([STATIC_CACHE, AUDIO_CACHE, API_CACHE]);
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map((cacheName) => {
      if (keep.has(cacheName)) return Promise.resolve();
      // 清理本应用历史桶（含未知前缀的遗留名），避免旧 content 与新版本混用
      if (
        cacheName.startsWith('music-static-') ||
        cacheName.startsWith('api-cache-') ||
        cacheName.startsWith('audio-cache-') ||
        cacheName.startsWith('music-') ||
        cacheName.includes('music-player')
      ) {
        // 音频桶与主线程共用，名称固定，已在 keep 中
        if (cacheName === AUDIO_CACHE) return Promise.resolve();
        console.log(`[sw] 删除旧缓存: ${cacheName}`);
        return caches.delete(cacheName);
      }
      return Promise.resolve();
    }),
  );
}

async function clearVersionedAppCaches() {
  const names = await caches.keys();
  await Promise.all(
    names.map((name) => {
      if (name.startsWith('music-static-') || name.startsWith('api-cache-')) {
        console.log(`[sw] 强制清理: ${name}`);
        return caches.delete(name);
      }
      return Promise.resolve();
    }),
  );
}

// 安装 Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => {
        return Promise.allSettled(
          STATIC_RESOURCES.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`静态资源缓存失败: ${url}`, err);
              return null;
            }),
          ),
        );
      }),
      caches.open(STATIC_CACHE).then((cache) => {
        return Promise.allSettled(
          IMAGE_RESOURCES.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`图片资源缓存失败: ${url}`, err);
              return null;
            }),
          ),
        );
      }),
      caches.open(STATIC_CACHE).then((cache) => {
        if (!BUILD_ASSET_PRECACHE.length) return Promise.resolve();
        return Promise.allSettled(
          BUILD_ASSET_PRECACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`预缓存构建资源失败: ${url}`, err);
              return null;
            }),
          ),
        );
      }),
      caches.open(STATIC_CACHE).then((cache) => {
        if (!COVER_PRECACHE.length) return Promise.resolve();
        return Promise.allSettled(
          COVER_PRECACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`预缓存封面失败: ${url}`, err);
              return null;
            }),
          ),
        );
      }),
    ])
      .then(() => {
        console.log(`Service Worker ${CACHE_VERSION} 安装完成`);
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('Service Worker 安装失败:', err);
        return self.skipWaiting();
      }),
  );
});

// 激活：强制清理非当前版本桶，并接管客户端
self.addEventListener('activate', (event) => {
  event.waitUntil(
    deleteOutdatedCaches()
      .then(() => {
        console.log(`Service Worker ${CACHE_VERSION} 激活完成`);
        return self.clients.claim();
      })
      .then(() =>
        self.clients.matchAll({ type: 'window' }).then((clients) => {
          for (const client of clients) {
            client.postMessage({
              type: 'SW_ACTIVATED',
              cacheVersion: CACHE_VERSION,
            });
          }
        }),
      ),
  );
});

// 主线程控制：skipWaiting / 强制清理版本化缓存
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  const action = data.action || data.type;
  if (action === 'skipWaiting') {
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (action === 'CLEAR_APP_CACHES' || action === 'forceRefreshCaches') {
    event.waitUntil(
      clearVersionedAppCaches().then(async () => {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.postMessage({ type: 'APP_CACHES_CLEARED', cacheVersion: CACHE_VERSION });
        }
      }),
    );
  }
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // 音频（含 Range）
  if (isAudioRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(AUDIO_CACHE);
          const cachedResponse = await cache.match(request);
          const isRangeRequest = request.headers.has('range');

          if (cachedResponse && !isRangeRequest) {
            return cachedResponse;
          }

          try {
            const networkResponse = await fetch(request);

            if (networkResponse.ok) {
              if (isRangeRequest) {
                return networkResponse;
              }

              if (networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                event.waitUntil(quietCachePut(cache.put(request, responseToCache)));
              }

              return networkResponse;
            }

            if (cachedResponse) {
              if (isRangeRequest) {
                return handleRangeRequest(request, cachedResponse);
              }
              return cachedResponse;
            }

            return networkResponse;
          } catch (networkError) {
            console.warn('网络请求失败，尝试使用缓存:', networkError);

            if (cachedResponse) {
              if (isRangeRequest) {
                return handleRangeRequest(request, cachedResponse);
              }
              return cachedResponse;
            }

            return new Response('您已离线或网络不可用，且该音频尚未被缓存，请联网后重试。', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          }
        } catch (error) {
          console.error('音频缓存处理错误:', error);
          return new Response('处理该音频缓存时出错，请稍后重试或刷新页面。', {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  // API：网络优先；仅缓存安全的 GET；写入类（如 /api/gist）绝不进 API 桶
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        const method = (request.method || 'GET').toUpperCase();
        const isMutableApi = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
        const isGistSync = url.pathname === '/api/gist';

        if (isMutableApi || isGistSync) {
          try {
            return await fetch(request, { cache: 'no-store' });
          } catch {
            return new Response(
              JSON.stringify({
                error: '网络不可用或已离线，写入类接口无法使用本地缓存代替，请联网后重试。',
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
              },
            );
          }
        }

        const cache = await caches.open(API_CACHE);

        try {
          const fetchResponse = await fetch(request, { cache: 'no-store' });
          if (fetchResponse.ok && fetchResponse.status === 200) {
            const responseToCache = fetchResponse.clone();
            event.waitUntil(quietCachePut(putApiCacheEntry(cache, request, responseToCache, url)));
          }
          return fetchResponse;
        } catch {
          const cachedResponse = await matchApiCache(cache, request, url);
          if (cachedResponse && isApiCacheFresh(cachedResponse)) {
            return cachedResponse;
          }
          return new Response(
            JSON.stringify({
              error: cachedResponse
                ? '网络不可用，且本地接口缓存已过期，请联网后重试。'
                : '网络不可用或已离线，且该接口尚无本地缓存，请联网后重试。',
              stale: Boolean(cachedResponse),
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            },
          );
        }
      })(),
    );
    return;
  }

  // 壳层与清单：始终网络优先 + 规范键（避免旧 music.json / index 残留）
  if (isShellPath(url.pathname) || request.destination === 'document') {
    event.respondWith(
      networkFirstShell(request, url, (p) => {
        event.waitUntil(p);
      }),
    );
    return;
  }

  // Vite 产物：安装阶段已预缓存，离线必须走缓存优先
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      cacheFirstAsset(request, STATIC_CACHE, (p) => {
        event.waitUntil(p);
      }),
    );
    return;
  }

  // 其余静态资源
  if (
    ['style', 'script', 'image', 'font'].includes(request.destination) ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/covers/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      (async () => {
        const isScriptOrStyle =
          request.destination === 'script' ||
          request.destination === 'style' ||
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css');

        // 非 /assets/ 的脚本样式：网络优先，降低旧 UI 残留
        if (isScriptOrStyle) {
          return networkFirstShell(request, url, (p) => {
            event.waitUntil(p);
          });
        }

        // 图片等：缓存优先（版本桶在 activate 时整体替换）
        const cache = await caches.open(STATIC_CACHE);
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;

        try {
          const fetchResponse = await fetch(request);
          if (fetchResponse.ok) {
            event.waitUntil(quietCachePut(cache.put(request, fetchResponse.clone())));
          }
          return fetchResponse;
        } catch {
          const recovered = await cache.match(request);
          if (recovered) return recovered;
          return new Response('资源不可用：当前离线且未命中本地缓存。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
  }
});
