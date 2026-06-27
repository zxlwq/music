import { getAllCoverUrls } from './covers';

class ImagePreloader {
  constructor() {
    this.cache = new Map();
    this.loadingPromises = new Map();
    this.maxCacheSize = 50;
  }

  /**
   * 预加载单张图片
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

    const promise = new Promise((resolve, reject) => {
      const img = new Image();

      if (options.crossOrigin) {
        img.crossOrigin = options.crossOrigin;
      }

      img.onload = () => {
        this.cacheImage(src, img);
        resolve(img);
      };

      img.onerror = (_error) => {
        reject(new Error(`图片加载失败: ${src}`));
      };

      const timeout = options.timeout || 10000;
      setTimeout(() => {
        reject(new Error(`图片加载超时: ${src}`));
      }, timeout);

      img.src = src;
    });

    this.loadingPromises.set(src, promise);

    try {
      const result = await promise;
      this.loadingPromises.delete(src);
      return result;
    } catch (error) {
      this.loadingPromises.delete(src);
      throw error;
    }
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
 * 获取图片预加载器实例
 * @returns {ImagePreloader}
 */
export function getImagePreloader() {
  return imagePreloader;
}

export default imagePreloader;
