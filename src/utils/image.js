import { getAllCoverUrls } from './covers';

class ImagePreloader {
  constructor() {
    this.cache = new Map();
    this.loadingPromises = new Map();
    this.maxCacheSize = 50;
  }

  /**
   * 预加载单张图片（失败时静默重试）
   * @param {string} src - 图片URL
   * @param {Object} options - 选项
   * @returns {Promise<HTMLImageElement>}
   */
  async preloadImage(src, options = {}) {
    if (!src) return null;

    if (this.cache.has(src)) {
      return this.cache.get(src);
    }

    if (this.loadingPromises.has(src)) {
      return this.loadingPromises.get(src);
    }

    const retries = Number.isFinite(options.retries) ? Math.max(0, options.retries) : 2;

    const promise = (async () => {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await this.loadImageOnce(src, options);
        } catch (error) {
          lastError = error;
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
      }
      throw lastError;
    })();

    this.loadingPromises.set(src, promise);

    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(src);
    }
  }

  /**
   * 单次加载（带超时清理）
   * @param {string} src
   * @param {Object} options
   * @returns {Promise<HTMLImageElement>}
   */
  loadImageOnce(src, options = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;

      if (options.crossOrigin) {
        img.crossOrigin = options.crossOrigin;
      }

      const timeoutMs = options.timeout || 10000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        img.src = '';
        reject(new Error(`图片加载超时: ${src}`));
      }, timeoutMs);

      img.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cacheImage(src, img);
        resolve(img);
      };

      img.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`图片加载失败: ${src}`));
      };

      img.src = src;
    });
  }

  /**
   * 批量预加载图片
   * @param {string[]} srcs - 图片URL数组
   * @param {Object} options - 选项
   * @returns {Promise<HTMLImageElement[]>}
   */
  async preloadImages(srcs, options = {}) {
    if (!Array.isArray(srcs) || srcs.length === 0) return [];

    const { concurrency = 3, ...imageOptions } = options;

    const results = [];
    const errors = [];

    for (let i = 0; i < srcs.length; i += concurrency) {
      const batch = srcs.slice(i, i + concurrency);
      const batchPromises = batch.map((src) =>
        this.preloadImage(src, imageOptions).catch((error) => {
          errors.push({ src, error });
          return null;
        }),
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(Boolean));
    }

    return results;
  }

  /**
   * 缓存图片
   * @param {string} src - 图片URL
   * @param {HTMLImageElement} img - 图片元素
   */
  cacheImage(src, img) {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(src, img);
  }

  /**
   * 获取缓存的图片
   * @param {string} src - 图片URL
   * @returns {HTMLImageElement|null}
   */
  getCachedImage(src) {
    return this.cache.get(src) || null;
  }

  clearCache() {
    this.cache.clear();
    this.loadingPromises.clear();
  }

  /**
   * 获取缓存统计信息
   * @returns {Object}
   */
  getCacheStats() {
    return {
      cacheSize: this.cache.size,
      loadingCount: this.loadingPromises.size,
      maxCacheSize: this.maxCacheSize,
    };
  }
}

const imagePreloader = new ImagePreloader();

/**
 * 预加载封面图片
 * @param {Array} tracks - 歌曲列表
 * @returns {Promise<void>}
 */
export async function preloadCoverImages(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return;

  const coverUrls = tracks
    .map((track) => track.cover)
    .filter(Boolean)
    .filter((url, index, arr) => arr.indexOf(url) === index); // 去重

  if (coverUrls.length === 0) return;

  try {
    await imagePreloader.preloadImages(coverUrls, {
      concurrency: 2,
      crossOrigin: 'anonymous',
      timeout: 8000,
      retries: 2,
    });
  } catch {}
}

/**
 * 预加载背景图片
 * @param {string} bgUrl - 背景图片URL
 * @returns {Promise<void>}
 */
export async function preloadBackgroundImage(bgUrl) {
  if (!bgUrl) return;

  try {
    await imagePreloader.preloadImage(bgUrl, {
      crossOrigin: 'anonymous',
      timeout: 10000,
    });
  } catch {}
}

/**
 * 预加载默认封面图片
 * @returns {Promise<void>}
 */
export async function preloadDefaultCovers() {
  const defaultCovers = getAllCoverUrls();

  try {
    await imagePreloader.preloadImages(defaultCovers, {
      concurrency: 3,
      timeout: 5000,
    });
  } catch {}
}

/**
 * 将本地图片压缩为可写入 localStorage 的 dataURL（长边限制 + JPEG）。
 * @param {Blob|File} file
 * @param {{ maxEdge?: number, quality?: number }} [opts]
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number }>}
 */
export async function compressImageToDataUrl(file, opts = {}) {
  const maxEdge = opts.maxEdge ?? 1920;
  const quality = opts.quality ?? 0.82;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // 少数环境不支持 createImageBitmap，退回 HTMLImageElement
    const objectUrl = URL.createObjectURL(file);
    try {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const srcW = bitmap.width || bitmap.naturalWidth;
  const srcH = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    if (typeof bitmap.close === 'function') bitmap.close();
    throw new Error('无法创建画布');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    dataUrl,
    width,
    height,
    bytes: Math.ceil((dataUrl.length * 3) / 4),
  };
}

/**
 * 获取图片预加载器实例
 * @returns {ImagePreloader}
 */
export function getImagePreloader() {
  return imagePreloader;
}

export default imagePreloader;
