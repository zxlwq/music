import { markDeletedByUrl, persistExtraTracksMerge } from './localState';

export const persistAdd = (items) => {
  persistExtraTracksMerge(items);
};

export const persistRemoveByUrl = (url, tracks) => {
  markDeletedByUrl(url, tracks);
};

export const clearAudioCache = (audioUrl) => {
  try {
    const baseUrl = audioUrl.split('?')[0];
    if ('caches' in window) {
      caches.keys().then((cacheNames) => {
        cacheNames.forEach((cacheName) => {
          caches.open(cacheName).then((cache) => {
            cache.delete(baseUrl);
            cache.delete(audioUrl);
          });
        });
      });
    }
    if (baseUrl.startsWith('http')) {
      fetch(baseUrl, { method: 'HEAD', cache: 'no-cache' }).catch(() => {});
    }
  } catch (e) {
    console.warn('清除缓存失败:', e);
  }
};
