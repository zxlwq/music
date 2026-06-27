/**
 * 从文件名生成展示用标题（下划线保留，不替换为空格）。
 * @param {string} filename 文件名或路径片段（会去掉最后一个扩展名再规范化）
 */
export function filenameToDisplayTitle(filename) {
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  let title = base.replace(/\s*-\s*/g, ' - ');
  title = title.replace(/\s{2,}/g, ' ');
  return title.trim();
}

/**
 * 从远程列表项解析标题：优先 `title`，否则用 `name` / `filename` 走 `filenameToDisplayTitle`；
 * 仍为空时返回 `Track ${index + 1}`（index 为 0-based）。
 * @param {{ title?: string, name?: string, filename?: string }} item
 * @param {number} index
 */
export function displayTitleFromRemoteItem(item, index) {
  const provided = String(item?.title ?? '').trim();
  if (provided) return provided;
  const raw = String(item?.name || item?.filename || '').trim();
  if (raw) {
    const t = filenameToDisplayTitle(raw);
    if (t) return t;
  }
  return `Track ${index + 1}`;
}
