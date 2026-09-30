/** 本地歌单支持的音频扩展名（小写，含点） */
export const MUSIC_FILE_EXTS = Object.freeze([
  '.mp3',
  '.flac',
  '.wav',
  '.aac',
  '.m4a',
  '.ogg',
  '.opus',
  '.webm',
]);

/**
 * 严格文件名：`歌曲名 - 歌手名_合唱歌手名.扩展名`
 * - 歌名与歌手之间必须是单个 ` - `
 * - 多名歌手仅用 `_` 连接
 * - 扩展名小写；歌名/歌手两侧无多余空白
 * @param {string} filename 仅文件名（可含路径时取 basename 语义由调用方保证）
 */
export function isStrictMusicFileName(filename) {
  const name = String(filename || '');
  if (!name || name.includes('/') || name.includes('\\')) return false;
  const m = name.match(/^(.+) - (.+)(\.[^.]+)$/);
  if (!m) return false;
  const [, song, artists, ext] = m;
  if (!MUSIC_FILE_EXTS.includes(ext.toLowerCase())) return false;
  if (ext !== ext.toLowerCase()) return false;
  if (!song || song !== song.trim() || /\s{2,}/.test(song) || song.includes(' - ')) return false;
  if (!artists || artists !== artists.trim() || /\s{2,}/.test(artists)) return false;
  if (/[/、,，&]/.test(artists)) return false;
  if (artists.startsWith('_') || artists.endsWith('_') || artists.includes('__')) return false;
  if (artists.split('_').some((p) => !p || p !== p.trim())) return false;
  return true;
}

/**
 * 将文件名规范为 `歌曲名 - 歌手名_合唱歌手名.扩展名`。
 * 无法识别（缺少 ` - ` 分隔）时返回 `null`。
 * @param {string} filename
 * @returns {string | null}
 */
export function normalizeMusicFileName(filename) {
  const raw = String(filename || '').trim();
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const extRaw = raw.slice(dot);
  const ext = extRaw.toLowerCase();
  if (!MUSIC_FILE_EXTS.includes(ext)) return null;

  let base = raw
    .slice(0, dot)
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const sep = ' - ';
  const idx = base.indexOf(sep);
  if (idx <= 0 || idx + sep.length >= base.length) return null;

  const song = base.slice(0, idx).trim();
  let artists = base.slice(idx + sep.length).trim();
  if (!song || !artists || song.includes(sep)) return null;

  artists = artists
    .replace(/\s*[／/、,，&]\s*/g, '_')
    .replace(/\s*_+\s*/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!artists || artists.split('_').some((p) => !p)) return null;

  return `${song} - ${artists}${ext}`;
}

/**
 * 严格展示标题（无扩展名）：`歌曲名 - 歌手名_合唱歌手名`
 * @param {string} title
 */
export function isStrictMusicTitle(title) {
  const t = String(title || '').trim();
  if (!t || t.includes('/') || t.includes('\\')) return false;
  return isStrictMusicFileName(`${t}.mp3`);
}

/**
 * 将展示标题规范为 `歌曲名 - 歌手名_合唱歌手名`；无法识别时返回 `null`。
 * @param {string} title 可带或不带扩展名
 * @returns {string | null}
 */
export function normalizeMusicTitle(title) {
  const raw = String(title || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const hasExt = MUSIC_FILE_EXTS.some((e) => lower.endsWith(e));
  const normalized = normalizeMusicFileName(hasExt ? raw : `${raw}.mp3`);
  return normalized ? normalized.replace(/\.[^.]+$/, '') : null;
}

/**
 * 从文件名生成展示用标题（下划线保留，不替换为空格）。
 * 能规范时返回严格格式；否则做轻量空白/` - ` 整理（不保证严格）。
 * @param {string} filename 文件名或路径片段（会去掉最后一个扩展名再规范化）
 */
export function filenameToDisplayTitle(filename) {
  const normalized = normalizeMusicFileName(filename);
  if (normalized) return normalized.replace(/\.[^.]+$/, '');
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  let title = base.replace(/\s+-\s+/g, ' - ');
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
