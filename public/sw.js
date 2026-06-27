// dist 构建后由 scripts/precache.mjs 替换 CACHE_VERSION、BUILD_ASSET_PRECACHE 与 COVER_PRECACHE
const CACHE_VERSION = 'v1-dev'; // SW-AUTO-CACHEV
const BUILD_ASSET_PRECACHE = []; // SW-AUTO-PRECACHE
const COVER_PRECACHE = []; // SW-AUTO-COVER-PRECACHE

const STATIC_CACHE = `music-static-${CACHE_VERSION}`;
/** 与 src/constants/Bucket.js 中 AUDIO_CACHE_BUCKET 保持一致（不按 SW 版本轮换，便于主线程与 SW 共用） */
const AUDIO_CACHE = 'music-player-audio';
const API_CACHE = `api-cache-${CACHE_VERSION}`;

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

/** 歌单接口常带 `?t=` 防 HTTP 缓存；SW 内用无查询串 URL 作缓存键，离线任意 `t` 均可命中（与 music.json 的 ignoreSearch 思路一致） */
function isMusicListApiPath(pathname) {
  return pathname === '/api/music/list';
}

function musicListCacheKeyRequest(url) {
  return new Request(`${url.origin}/api/music/list`, { method: 'GET' });
}

async function matchApiCache(cache, request, url) {
  if (isMusicListApiPath(url.pathname)) {
    return cache.match(musicListCacheKeyRequest(url));
  }
  return cache.match(request);
}

function putApiCacheEntry(cache, request, responseClone, url) {
  const keyRequest = isMusicListApiPath(url.pathname) ? musicListCacheKeyRequest(url) : request;
  return cache.put(keyRequest, responseClone);
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
        scheduleWrite(cache.put(request, toStore));
      } else {
        await cache.put(request, toStore);
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

// 处理 Range 请求
async function handleRangeRequest(request, cachedResponse) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader || !cachedResponse) {
    return cachedResponse;
  }

  try {
    const blob = await cachedResponse.blob();
    const totalLength = blob.size;

    // 解析 Range 头
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
        self.skipWaiting();
      })
      .catch((err) => {
        console.error('Service Worker 安装失败:', err);
        self.skipWaiting();
      }),
  );
});

// 激活 Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // 保留当前版本的缓存，删除旧版本
            if (
              cacheName !== STATIC_CACHE &&
              cacheName !== AUDIO_CACHE &&
              cacheName !== API_CACHE &&
              (cacheName.startsWith('music-static-') ||
                cacheName.startsWith('audio-cache-') ||
                cacheName.startsWith('api-cache-'))
            ) {
              console.log(`删除旧缓存: ${cacheName}`);
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          }),
        );
      })
      .then(() => {
        console.log(`Service Worker ${CACHE_VERSION} 激活完成`);
        return self.clients.claim();
      }),
  );
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  // 处理音频请求（包括 Range 请求）
  if (isAudioRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(AUDIO_CACHE);
          const cachedResponse = await cache.match(request);
          const isRangeRequest = request.headers.has('range');

          // 对于非 Range 请求：缓存命中优先返回
          if (cachedResponse && !isRangeRequest) {
            return cachedResponse;
          }

          // 尝试从网络获取
          try {
            const networkResponse = await fetch(request);

            if (networkResponse.ok) {
              // 对于 Range 请求，不写入 Cache，直接把网络响应返回给浏览器
              if (isRangeRequest) {
                return networkResponse;
              }

              // 只缓存完整响应（非 206）
              if (networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                event.waitUntil(cache.put(request, responseToCache));
              }

              return networkResponse;
            }

            // 网络请求失败，尝试返回缓存
            if (cachedResponse) {
              if (isRangeRequest) {
                return handleRangeRequest(request, cachedResponse);
              }
              return cachedResponse;
            }

            return networkResponse;
          } catch (networkError) {
            console.warn('网络请求失败，尝试使用缓存:', networkError);

            // 网络失败，尝试返回缓存
            if (cachedResponse) {
              if (isRangeRequest) {
                return handleRangeRequest(request, cachedResponse);
              }
              return cachedResponse;
            }

            // 没有缓存，返回错误
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

  // 处理 API 请求：网络优先，避免缓存优先导致动态接口长期陈旧；离线再读 API_CACHE
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);

        try {
          const fetchResponse = await fetch(request);
          if (fetchResponse.ok && fetchResponse.status === 200) {
            const responseToCache = fetchResponse.clone();
            event.waitUntil(putApiCacheEntry(cache, request, responseToCache, url));
          }
          return fetchResponse;
        } catch {
          const cachedResponse = await matchApiCache(cache, request, url);
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(
            JSON.stringify({ error: '网络不可用或已离线，且该接口尚无本地缓存，请联网后重试。' }),
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

  // Vite 产物：安装阶段已预缓存，离线必须走缓存优先
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      cacheFirstAsset(request, STATIC_CACHE, (p) => {
        event.waitUntil(p);
      }),
    );
    return;
  }

  // 处理静态资源
  if (
    request.destination === 'document' ||
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
    url.pathname.endsWith('.ico') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/webmanifest' ||
    url.pathname === '/music.json'
  ) {
    event.respondWith(
      (async () => {
        // 对于 HTML 和 JS/CSS 文件，使用"网络优先"策略，避免缓存旧版本
        const isHtmlOrScript =
          request.destination === 'document' ||
          request.destination === 'script' ||
          request.destination === 'style' ||
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css');

        if (isHtmlOrScript) {
          // 网络优先：先尝试网络，失败再用缓存
          try {
            const fetchResponse = await fetch(request);
            if (fetchResponse.ok) {
              const responseToCache = fetchResponse.clone();
              const cache = await caches.open(STATIC_CACHE);
              event.waitUntil(cache.put(request, responseToCache));
            }
            return fetchResponse;
          } catch {
            // 网络失败，尝试使用缓存
            const cachedResponse = await caches.match(request);
            if (cachedResponse) {
              return cachedResponse;
            }
            if (request.destination === 'document') {
              const fallback = await caches.match('/index.html');
              if (fallback) return fallback;
            }
            return new Response('资源不可用：当前离线且未命中本地缓存。', {
              status: 404,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          }
        } else {
          // 其他静态资源（图片等）使用"缓存优先"策略
          // music.json / webmanifest：安装阶段缓存的是无查询串 URL；页面带 ?t= 时必须忽略 search 才能命中
          const ignoreSearch = url.pathname === '/music.json' || url.pathname === '/webmanifest';
          const cacheOpts = ignoreSearch ? { ignoreSearch: true } : {};
          let cachedResponse = await caches.match(request, cacheOpts);
          if (cachedResponse) {
            return cachedResponse;
          }

          try {
            const fetchResponse = await fetch(request);
            if (fetchResponse.ok) {
              const responseToCache = fetchResponse.clone();
              const cache = await caches.open(STATIC_CACHE);
              event.waitUntil(cache.put(request, responseToCache));
            }
            return fetchResponse;
          } catch {
            const recovered = await caches.match(request, cacheOpts);
            if (recovered) return recovered;
            return new Response('资源不可用：当前离线且未命中本地缓存。', {
              status: 404,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          }
        }
      })(),
    );
  }
});
