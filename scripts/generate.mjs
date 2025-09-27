import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const PUBLIC_DIR = path.join(ROOT, 'public')
const MUSIC_DIR = path.join(PUBLIC_DIR, 'music')
const MANIFEST_FILE = path.join(PUBLIC_DIR, 'manifest.json')
const COVERS_DIR = path.join(PUBLIC_DIR, 'covers')

const SUPPORTED_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm']
const SUPPORTED_COVER_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

function toTitle(filename) {
  const base = filename.replace(/\.[^.]+$/, '')
  let title = base.replace(/\s*-\s*/g, ' - ')
  title = title.replace(/_/g, ' ').replace(/\s{2,}/g, ' ')
  return title.trim()
}

async function scanMusic(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const it of items) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) {
      files.push(...await scanMusic(full))
    } else {
      const ext = path.extname(it.name).toLowerCase()
      if (SUPPORTED_EXTS.includes(ext)) files.push(full)
    }
  }
  return files
}

async function scanCovers(dir) {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true })
    const files = []
    for (const it of items) {
      if (!it.isFile()) continue
      const ext = path.extname(it.name).toLowerCase()
      if (SUPPORTED_COVER_EXTS.includes(ext)) files.push(path.join(dir, it.name))
    }
    return files
  } catch {
    return []
  }
}

async function main() {
  await ensureDir(MUSIC_DIR)
  const files = await scanMusic(MUSIC_DIR)
  const coverFiles = await scanCovers(COVERS_DIR)
  const preferredOrder = [
    'a.png','b.png','c.png','d.png','e.png','f.png','g.png','h.png','j.png','k.png','l.png','m.png','n.png','o.png','p.png','q.png','r.png','s.png','t.png','u.png'
  ]
  const byName = new Map(coverFiles.map(f => [path.basename(f).toLowerCase(), f]))
  const ordered = []
  for (const name of preferredOrder) {
    const file = byName.get(name)
    if (file) ordered.push(file)
  }
  const rest = coverFiles.filter(f => !ordered.includes(f)).sort((a, b) => a.localeCompare(b))
  const coversSorted = [...ordered, ...rest]

  const tracks = files.sort().map((absPath, index) => {
    const rel = path.posix.join('music', path.relative(MUSIC_DIR, absPath).split(path.sep).join('/'))
    const cover = coversSorted.length ? `/${path.posix.join('covers', path.basename(coversSorted[index % coversSorted.length]))}` : undefined
    const track = { title: toTitle(path.basename(absPath)), url: `/${rel}` }
    if (cover) track.cover = cover
    return track
  })
  const manifest = { generatedAt: new Date().toISOString(), tracks }
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`Manifest generated: ${tracks.length} tracks -> ${path.relative(ROOT, MANIFEST_FILE)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


