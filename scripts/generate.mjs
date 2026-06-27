import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scanCoverFileNames, sortCoverFileNames } from '../lib/covers.js';
import { filenameToDisplayTitle } from '../lib/title.js';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const MUSIC_DIR = path.join(PUBLIC_DIR, 'music');
/** 本地 public/music 扫描结果（歌单），与 PWA 的 webmanifest 分离 */
const MUSIC_LIST_FILE = path.join(PUBLIC_DIR, 'music.json');
const COVERS_DIR = path.join(PUBLIC_DIR, 'covers');
const COVER_FILES_JSON = path.join(ROOT, 'src', 'generated', 'cover-files.json');

const SUPPORTED_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function scanMusic(dir) {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        files.push(...(await scanMusic(full)));
      } else {
        const ext = path.extname(it.name).toLowerCase();
        if (SUPPORTED_EXTS.includes(ext)) files.push(full);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function main() {
  await ensureDir(MUSIC_DIR);
  await ensureDir(COVERS_DIR);
  await ensureDir(path.dirname(COVER_FILES_JSON));

  const files = await scanMusic(MUSIC_DIR);
  const coverNames = sortCoverFileNames(await scanCoverFileNames(COVERS_DIR));
  const coversSorted = coverNames.map((name) => path.join(COVERS_DIR, name));

  await fs.writeFile(
    COVER_FILES_JSON,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), files: coverNames }, null, 2)}\n`,
    'utf8',
  );

  const tracks = files.sort().map((absPath, index) => {
    const rel = path.posix.join(
      'music',
      path.relative(MUSIC_DIR, absPath).split(path.sep).join('/'),
    );
    const cover = coversSorted.length
      ? `/${path.posix.join('covers', path.basename(coversSorted[index % coversSorted.length]))}`
      : undefined;
    const track = { title: filenameToDisplayTitle(path.basename(absPath)), url: `/${rel}` };
    if (cover) track.cover = cover;
    return track;
  });
  const manifest = { generatedAt: new Date().toISOString(), tracks };
  await fs.writeFile(MUSIC_LIST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

main().catch((_e) => {
  process.exit(1);
});
