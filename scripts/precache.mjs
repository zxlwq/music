/**
 * 构建完成后向 dist/sw.js 注入预缓存 URL 与 CACHE_VERSION，
 * 使 Service Worker 安装阶段拉取全部 /assets/* 产物与 /covers/* 封面，离线可加载前端壳与唱片封面。
 *
 * 须与仓库根目录 public/sw.js 中的占位行保持一致（`SW-AUTO-CACHEV` / `SW-AUTO-PRECACHE` / `SW-AUTO-COVER-PRECACHE`）；
 * 若调整静态缓存版本策略或音频识别路径（如 isAudioRequest），请同步改 public/sw.js 再构建。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SW_FILE = path.join(DIST, 'sw.js');
const COVER_FILES_JSON = path.join(ROOT, 'src', 'generated', 'cover-files.json');

const COVER_IMAGE_RE = /\.(webp|png|jpe?g|gif|svg)$/i;

function walkFiles(dir, baseDir, acc) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, baseDir, acc);
    } else if (/\.(js|css|woff2?|ttf|eot|svg)$/i.test(ent.name)) {
      acc.push('/' + path.relative(baseDir, full).replace(/\\/g, '/'));
    }
  }
}

function urlsFromIndexHtml(html) {
  const out = [];
  const reScript = /<script[^>]+src="([^"]+)"/gi;
  const reLink = /<link[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = reScript.exec(html))) out.push(m[1].split('?')[0]);
  while ((m = reLink.exec(html))) {
    const href = m[1].split('?')[0];
    if (/\.(css|js)$/i.test(href)) out.push(href);
  }
  return out;
}

function coverUrlsFromDist() {
  const coversDir = path.join(DIST, 'covers');
  if (existsSync(coversDir)) {
    return readdirSync(coversDir, { withFileTypes: true })
      .filter((ent) => ent.isFile() && COVER_IMAGE_RE.test(ent.name))
      .map((ent) => `/covers/${ent.name}`)
      .sort();
  }

  if (!existsSync(COVER_FILES_JSON)) return [];
  try {
    const data = JSON.parse(readFileSync(COVER_FILES_JSON, 'utf8'));
    return (data.files ?? [])
      .filter((name) => COVER_IMAGE_RE.test(name))
      .map((name) => `/covers/${name}`)
      .sort();
  } catch {
    return [];
  }
}

function main() {
  if (!existsSync(SW_FILE)) {
    console.warn('[precache] dist/sw.js 不存在，跳过（请先 vite build）');
    return;
  }

  const indexPath = path.join(DIST, 'index.html');
  if (!existsSync(indexPath)) {
    console.warn('[precache] dist/index.html 不存在，跳过');
    return;
  }

  const html = readFileSync(indexPath, 'utf8');
  const indexUrls = urlsFromIndexHtml(html);

  const assetDir = path.join(DIST, 'assets');
  const diskUrls = [];
  walkFiles(assetDir, DIST, diskUrls);

  const merged = [
    ...new Set([...indexUrls, ...diskUrls].map((u) => u.replace(/^\.\//, ''))),
  ].filter((u) => u.startsWith('/'));

  const coverUrls = coverUrlsFromDist();

  const hash = createHash('sha256').update(html).digest('hex').slice(0, 10);
  const cacheVersion = `p-${hash}`;

  let sw = readFileSync(SW_FILE, 'utf8');

  sw = sw.replace(
    /const CACHE_VERSION = '[^']*'; \/\/ SW-AUTO-CACHEV/,
    `const CACHE_VERSION = '${cacheVersion}'; // SW-AUTO-CACHEV`,
  );

  sw = sw.replace(
    /const BUILD_ASSET_PRECACHE = \[\]; \/\/ SW-AUTO-PRECACHE/,
    `const BUILD_ASSET_PRECACHE = ${JSON.stringify(merged)}; // SW-AUTO-PRECACHE`,
  );

  sw = sw.replace(
    /const COVER_PRECACHE = \[\]; \/\/ SW-AUTO-COVER-PRECACHE/,
    `const COVER_PRECACHE = ${JSON.stringify(coverUrls)}; // SW-AUTO-COVER-PRECACHE`,
  );

  writeFileSync(SW_FILE, sw, 'utf8');
  console.log(
    '[precache] CACHE_VERSION =',
    cacheVersion,
    'assets =',
    merged.length,
    'covers =',
    coverUrls.length,
  );
}

main();
