/**
 * 封面列表由 scripts/generate.mjs 扫描 public/covers 自动生成。
 * 运行 npm run dev / npm run build 时会更新 src/generated/cover-files.json。
 */
import coverData from '../generated/cover-files.json';

export const COVER_FILES = coverData.files ?? [];

/**
 * 根据索引获取封面完整 URL（自动取模循环）
 * @param {number} index
 * @returns {string}
 */
export function getCoverUrlByIndex(index) {
  if (!COVER_FILES.length) return '';
  const safeIndex = (((index || 0) % COVER_FILES.length) + COVER_FILES.length) % COVER_FILES.length;
  const fileName = COVER_FILES[safeIndex];
  return `/covers/${fileName}`;
}

/**
 * 获取所有封面的完整 URL 列表
 * @returns {string[]}
 */
export function getAllCoverUrls() {
  return COVER_FILES.map((name) => `/covers/${name}`);
}
