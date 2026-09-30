/** 应用壳 / API 的 Cache Storage 版本桶前缀（与 public/sw.js 一致） */
const STATIC_CACHE_PREFIX = 'music-static-';
const API_CACHE_PREFIX = 'api-cache-';

/**
 * 删除版本化的静态与 API 缓存桶（保留音频桶 music-player-audio）。
 * 可在无 SW 时由主线程直接清理。
 */
export async function clearVersionedAppCaches() {
  if (typeof caches === 'undefined') return { deleted: [] };
  const deleted = [];
  const names = await caches.keys();
  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith(STATIC_CACHE_PREFIX) || name.startsWith(API_CACHE_PREFIX)) {
        const ok = await caches.delete(name);
        if (ok) deleted.push(name);
      }
    }),
  );
  return { deleted };
}

function postToServiceWorker(message) {
  const controller = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
  if (controller) {
    controller.postMessage(message);
    return true;
  }
  return false;
}

/**
 * 强制刷新应用缓存：清理静态/API 桶，通知 SW，并触发 registration.update。
 * 不清理音频离线缓存。完成后建议 reload。
 */
export async function forceRefreshAppCaches() {
  const { deleted } = await clearVersionedAppCaches();
  postToServiceWorker({ action: 'CLEAR_APP_CACHES' });

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        const waiting = reg.waiting;
        if (waiting) {
          waiting.postMessage({ action: 'skipWaiting' });
        }
      }
    } catch (e) {
      console.warn('[swCache] registration.update 失败:', e);
    }
  }

  // 主动打穿关键资源的 HTTP / SW 缓存
  const bust = Date.now();
  await Promise.allSettled([
    fetch(`/music.json?t=${bust}`, { cache: 'no-store', headers: { accept: 'application/json' } }),
    fetch(`/api/music/list?t=${bust}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    }),
    fetch(`/index.html?t=${bust}`, { cache: 'no-store' }),
    fetch(`/webmanifest?t=${bust}`, { cache: 'no-store' }),
  ]);

  return { deleted };
}
