export const persistAdd = (items) => {
  const extraRaw = localStorage.getItem('extraTracks');
  let extra = [];
  try {
    extra = JSON.parse(extraRaw || '[]');
  } catch {}
  const titleToIndex = new Map();
  for (let i = 0; i < extra.length; i++) {
    const t = extra[i];
    if (t && t.title) titleToIndex.set(t.title, i);
  }
  for (const it of items || []) {
    if (!it || !it.title) continue;
    const idx = titleToIndex.get(it.title);
    if (typeof idx === 'number') {
      const prev = extra[idx] || {};
      const next = { ...prev };
      if (it.url && !next.url) next.url = it.url;
      if (it.cover && !next.cover) next.cover = it.cover;
      if (it.mvUrl) next.mvUrl = it.mvUrl;
      if (!next.title) next.title = it.title;
      extra[idx] = next;
    } else {
      extra.push({ title: it.title || '', url: it.url, cover: it.cover, mvUrl: it.mvUrl });
      titleToIndex.set(it.title, extra.length - 1);
    }
  }
  localStorage.setItem('extraTracks', JSON.stringify(extra));
};

export const persistRemoveByUrl = (url, tracks) => {
  const extraRaw = localStorage.getItem('extraTracks');
  let extra = [];
  try {
    extra = JSON.parse(extraRaw || '[]');
  } catch {}
  let currentTitle = '';
  try {
    const found = (tracks || []).find((t) => t && t.url === url);
    currentTitle = found?.title || '';
  } catch {}
  const filtered = extra.filter(
    (x) => x && x.url !== url && (!currentTitle || x.title !== currentTitle),
  );
  localStorage.setItem('extraTracks', JSON.stringify(filtered));

  const overrideRaw = localStorage.getItem('overrideTracks');
  try {
    const o = JSON.parse(overrideRaw || '[]');
    const of = Array.isArray(o)
      ? o.filter((x) => x && x.url !== url && (!currentTitle || x.title !== currentTitle))
      : [];
    localStorage.setItem('overrideTracks', JSON.stringify(of));
  } catch {}

  try {
    const delRaw = localStorage.getItem('deletedUrls');
    const del = Array.isArray(JSON.parse(delRaw || '[]')) ? JSON.parse(delRaw || '[]') : [];
    if (!del.includes(url)) {
      const next = [...del, url];
      localStorage.setItem('deletedUrls', JSON.stringify(next));
    }
  } catch {}
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
