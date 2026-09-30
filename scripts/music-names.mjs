/**
 * 规范 public/music 音频文件名：`歌曲名 - 歌手名_合唱歌手名.扩展名`
 * - 默认：重命名不合规文件
 * - `--check`：仅检查，有不合规则 exit 1（供 format:check）
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MUSIC_FILE_EXTS, isStrictMusicFileName, normalizeMusicFileName } from '../lib/title.js';

const ROOT = process.cwd();
const MUSIC_DIR = path.join(ROOT, 'public', 'music');
const checkOnly = process.argv.includes('--check');

async function scanMusic(dir) {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    /** @type {string[]} */
    const files = [];
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        files.push(...(await scanMusic(full)));
      } else {
        const ext = path.extname(it.name).toLowerCase();
        if (MUSIC_FILE_EXTS.includes(ext)) files.push(full);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function main() {
  const files = await scanMusic(MUSIC_DIR);
  /** @type {{ from: string, to: string, reason: string }[]} */
  const problems = [];
  /** @type {{ from: string, to: string }[]} */
  const renames = [];

  for (const abs of files) {
    const dir = path.dirname(abs);
    const name = path.basename(abs);
    if (isStrictMusicFileName(name)) continue;

    const next = normalizeMusicFileName(name);
    if (!next) {
      problems.push({
        from: abs,
        to: '',
        reason: `无法规范为「歌曲名 - 歌手名_合唱歌手名.扩展名」: ${name}`,
      });
      continue;
    }
    if (next === name) {
      problems.push({
        from: abs,
        to: '',
        reason: `文件名仍不合规: ${name}`,
      });
      continue;
    }

    const dest = path.join(dir, next);
    if (dest !== abs) {
      try {
        await fs.access(dest);
        problems.push({
          from: abs,
          to: dest,
          reason: `目标已存在，跳过重命名: ${name} → ${next}`,
        });
        continue;
      } catch {
        /* dest free */
      }
    }
    renames.push({ from: abs, to: dest });
  }

  if (checkOnly) {
    if (renames.length || problems.length) {
      console.error(
        '[music-names] public/music 文件名未严格遵循「歌曲名 - 歌手名_合唱歌手名.扩展名」:',
      );
      for (const r of renames) {
        console.error(`  - ${path.relative(ROOT, r.from)} → ${path.basename(r.to)}`);
      }
      for (const p of problems) {
        console.error(`  - ${path.relative(ROOT, p.from)}: ${p.reason}`);
      }
      console.error('请运行 npm run format 自动规范（或手动改名）。');
      process.exit(1);
    }
    console.log('[music-names] public/music 文件名检查通过');
    return;
  }

  for (const r of renames) {
    await fs.rename(r.from, r.to);
    console.log(`[music-names] ${path.relative(ROOT, r.from)} → ${path.basename(r.to)}`);
  }

  if (problems.length) {
    for (const p of problems) {
      console.error(`[music-names] ${p.reason}`);
    }
    process.exit(1);
  }

  if (renames.length) {
    console.log(`[music-names] 已规范 ${renames.length} 个文件`);
  } else {
    console.log('[music-names] public/music 无需重命名');
  }
}

main().catch((e) => {
  console.error('[music-names]', e);
  process.exit(1);
});
