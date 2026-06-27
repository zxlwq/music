/**
 * @typedef {{ enabled?: boolean, maxCacheSize: number, preloadCount: number, preloadDelay: number }} AudioCacheUiConfig
 */

/**
 * 设置页绑定用：把 hook 里的 config 规整为确定数值（避免 TS 将 strip 后的对象推断成 unknown）
 * @param {unknown} config
 * @returns {AudioCacheUiConfig}
 */
export function asAudioCacheUiConfig(config) {
  const o =
    config && typeof config === 'object' ? /** @type {Record<string, unknown>} */ (config) : {};
  const num = (v, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  return {
    ...(typeof o.enabled === 'boolean' ? { enabled: o.enabled } : {}),
    maxCacheSize: Math.min(200, Math.max(1, Math.floor(num(o.maxCacheSize, 50)))),
    preloadCount: Math.min(10, Math.max(1, Math.floor(num(o.preloadCount, 3)))),
    preloadDelay: Math.min(5000, Math.max(100, Math.floor(num(o.preloadDelay, 1000)))),
  };
}

/**
 * 移除已删除的设置项，避免继续写入 localStorage / Gist（旧数据仍可安全忽略）
 * @param {Record<string, unknown>} config
 */
export function stripLegacyAudioCacheFields(config) {
  if (!config || typeof config !== 'object') return config;
  const rest = { ...config };
  delete rest.autoCleanup;
  delete rest.cleanupInterval;
  return rest;
}

/**
 * 从 localStorage 读取音频缓存「高级设置」（与设置页 / Gist 同步的 `audioCache.config`）
 */
export function getAudioCachePreloadSettings() {
  const defaults = { preloadCount: 3, preloadDelay: 1000 };
  try {
    const raw = localStorage.getItem('audioCache.config');
    if (!raw) return defaults;
    const c = JSON.parse(raw);
    const pc = Number(c.preloadCount);
    const pd = Number(c.preloadDelay);
    return {
      preloadCount: Number.isFinite(pc)
        ? Math.min(10, Math.max(1, Math.floor(pc)))
        : defaults.preloadCount,
      preloadDelay: Number.isFinite(pd)
        ? Math.min(5000, Math.max(100, Math.floor(pd)))
        : defaults.preloadDelay,
    };
  } catch {
    return defaults;
  }
}
