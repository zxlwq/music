import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SUPPORTED_COVER_EXTS = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg'];

/** 已知封面优先顺序；其余文件按文件名排序追加 */
export const DEFAULT_COVER_PREFERRED_ORDER = [
  'a.webp',
  'b.webp',
  'c.webp',
  'd.webp',
  'e.webp',
  'f.webp',
  'g.webp',
  'h.webp',
  'i.webp',
  'j.webp',
  'k.webp',
  'l.webp',
  'm.webp',
  'n.webp',
  'o.webp',
  'p.webp',
  'q.webp',
  'r.webp',
  's.webp',
  't.webp',
  'u.webp',
  'v.webp',
  'w.webp',
  'x.webp',
  'y.webp',
  'z.webp',
];

/**
 * @param {string[]} fileNames 封面文件名（basename）
 * @param {string[]} [preferredOrder]
 * @returns {string[]}
 */
export function sortCoverFileNames(fileNames, preferredOrder = DEFAULT_COVER_PREFERRED_ORDER) {
  const byName = new Map(fileNames.map((name) => [name.toLowerCase(), name]));
  const ordered = [];
  for (const name of preferredOrder) {
    const file = byName.get(name.toLowerCase());
    if (file) ordered.push(file);
  }
  const orderedSet = new Set(ordered.map((name) => name.toLowerCase()));
  const rest = fileNames
    .filter((name) => !orderedSet.has(name.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
}

/**
 * @param {string} coversDir
 * @returns {Promise<string[]>}
 */
export async function scanCoverFileNames(coversDir) {
  try {
    const items = await fs.readdir(coversDir, { withFileTypes: true });
    const names = [];
    for (const it of items) {
      if (!it.isFile()) continue;
      const ext = path.extname(it.name).toLowerCase();
      if (SUPPORTED_COVER_EXTS.includes(ext)) names.push(it.name);
    }
    return names;
  } catch {
    return [];
  }
}
