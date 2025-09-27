import React, { useEffect, useState } from 'react'
import Player from './components/Player.jsx'
import SearchBar from './components/SearchBar.jsx'
import Playlist from './components/Playlist.jsx'
import Password from './components/Password.jsx'
import Settings from './components/Settings.jsx'
import Progress from './components/Progress.jsx'

export default function App() {
  const [tracks, setTracks] = useState([])
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forcePlayKey, setForcePlayKey] = useState(0)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState('')
  const [pendingDeleteName, setPendingDeleteName] = useState('')
  const [passwordErrorCount, setPasswordErrorCount] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressTitle, setProgressTitle] = useState('')
  const [progressMessage, setProgressMessage] = useState('')
  const [progressValue, setProgressValue] = useState(0)

  const loadManifest = async () => {
      try {
        const res = await fetch('/manifest.json', { cache: 'no-store' })
        if (!res.ok) throw new Error(`加载清单失败: ${res.status}`)
        const data = await res.json()
        const overrideRaw = localStorage.getItem('overrideTracks')
        let override = []
        try { override = JSON.parse(overrideRaw || '[]') } catch {}
        const baseTracks = Array.isArray(data.tracks) ? data.tracks : []
        const extraRaw = localStorage.getItem('extraTracks')
        let extra = []
        try { extra = JSON.parse(extraRaw || '[]') } catch {}
        const localPreferred = ['a.png','b.png','c.png','d.png','e.png','f.png','g.png','h.png','j.png','k.png','l.png','m.png','n.png','o.png','p.png','q.png','r.png','s.png','t.png','u.png']
        const assignCovers = (list) => {
          let idx = 0
          return (list || []).map((t) => {
            if (t && t.cover) return t
            const assigned = { ...(t || {}) }
            assigned.cover = `/covers/${localPreferred[idx % localPreferred.length]}`
            idx++
            return assigned
          })
        }
        if (Array.isArray(override) && override.length) {
          // 当存在覆盖歌单时，仍需用 extraTracks 按标题合并补充 mvUrl 等信息
          const extraRaw2 = localStorage.getItem('extraTracks')
          let extra2 = []
          try { extra2 = JSON.parse(extraRaw2 || '[]') } catch {}
          const titleToExtra = new Map()
          for (const et of extra2) {
            if (et && et.title) titleToExtra.set(et.title, et)
          }
          const withCovers = assignCovers(override)
          const enriched = withCovers.map((t) => {
            const title = t?.title || ''
            const ext = titleToExtra.get(title)
            if (!ext) return t
            const merged = { ...t }
            if (!merged.mvUrl && ext.mvUrl) merged.mvUrl = ext.mvUrl
            if (!merged.cover && ext.cover) merged.cover = ext.cover
            return merged
          })
          setTracks(enriched)
        } else {
          // Merge base + extra (dedupe by title) and assign covers if missing; also merge mvUrl
          const titleToIndex = new Map()
          const merged = []
          let coverIdx = 0
          const pushWithCover = (item) => {
            if (!item.cover) {
              const cover = `/covers/${localPreferred[coverIdx % localPreferred.length]}`
              merged.push({ ...item, cover })
              coverIdx++
            } else {
              merged.push(item)
            }
            titleToIndex.set(item.title || '', merged.length - 1)
          }
          // seed with base tracks first, preserving order
          for (const t of baseTracks) {
            if (!t || !t.url) continue
            const title = t.title || ''
            if (titleToIndex.has(title)) continue
            pushWithCover(t)
          }
          // merge in extra: enrich existing by same title, otherwise append
          for (const t of extra) {
            if (!t || !t.url) continue
            const title = t.title || ''
            if (!titleToIndex.has(title)) {
              pushWithCover(t)
            } else {
              const idx = titleToIndex.get(title)
              const prev = merged[idx] || {}
              const enriched = { ...prev }
              if (!enriched.mvUrl && t.mvUrl) enriched.mvUrl = t.mvUrl
              if (!enriched.cover && t.cover) enriched.cover = t.cover
              merged[idx] = enriched
            }
          }
          // 回写本地 extraRecords 缺失封面的项
          const patchedExtra = []
          let extraCoverIdx = 0
          for (const et of extra) {
            if (!et || !et.url) continue
            if (!et.cover) {
              patchedExtra.push({ ...et, cover: `/covers/${localPreferred[extraCoverIdx % localPreferred.length]}` })
              extraCoverIdx++
            } else {
              patchedExtra.push(et)
            }
          }
          if (patchedExtra.length === extra.length) {
            localStorage.setItem('extraTracks', JSON.stringify(patchedExtra))
          }
          setTracks(merged)
        }
      } catch (e) {
        setError(e.message || '清单加载错误')
      } finally {
        setLoading(false)
      }
    }
  
  useEffect(() => { loadManifest() }, [])

  // 初始化应用已保存的美化设置（字体与背景图）
  useEffect(() => {
    try {
      const ff = localStorage.getItem('ui.fontFamily') || ''
      const bg = localStorage.getItem('ui.bgUrl') || ''
      const root = document.documentElement
      const body = document.body
      
      if (root) {
        // 更新 CSS 变量，影响所有元素
        root.style.setProperty('--font-family', ff || 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial')
      }
      
      if (body && bg) {
        const base = "linear-gradient(180deg, rgba(0, 0, 0, .3), rgba(0, 0, 0, .3))"
        body.style.backgroundImage = `${base}, url('${bg}')`
      }
    } catch {}
  }, [])

  // 全局键盘快捷键支持
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 避免在输入框中触发快捷键
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') {
        return
      }
      
      // 避免影响系统快捷键
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return
      }
      
      // Escape键关闭所有模态框
      if (e.key === 'Escape') {
        e.preventDefault()
        if (confirmOpen) {
          setConfirmOpen(false)
          setPendingDeleteUrl('')
          setPendingDeleteName('')
        } else if (settingsOpen) {
          setSettingsOpen(false)
        } else if (progressOpen) {
          setProgressOpen(false)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [confirmOpen, settingsOpen, progressOpen])

  // 本地持久化：新增与删除
  const persistAdd = (items) => {
    const extraRaw = localStorage.getItem('extraTracks')
    let extra = []
    try { extra = JSON.parse(extraRaw || '[]') } catch {}
    const titleToIndex = new Map()
    for (let i = 0; i < extra.length; i++) {
      const t = extra[i]
      if (t && t.title) titleToIndex.set(t.title, i)
    }
    for (const it of items || []) {
      if (!it || !it.title) continue
      const idx = titleToIndex.get(it.title)
      if (typeof idx === 'number') {
        const prev = extra[idx] || {}
        const next = { ...prev }
        // 更新或补充字段（尤其是 mvUrl）
        if (it.url && !next.url) next.url = it.url
        if (it.cover && !next.cover) next.cover = it.cover
        if (it.mvUrl) next.mvUrl = it.mvUrl
        if (!next.title) next.title = it.title
        extra[idx] = next
      } else {
        // 即使同名已存在于基础清单里，这里也追加一条轻量记录用于后续合并富化（含 mvUrl）
        extra.push({ title: it.title || '', url: it.url, cover: it.cover, mvUrl: it.mvUrl })
        titleToIndex.set(it.title, extra.length - 1)
      }
    }
    localStorage.setItem('extraTracks', JSON.stringify(extra))
  }

  const persistRemoveByUrl = (url) => {
    // 从 extraTracks 中移除
    const extraRaw = localStorage.getItem('extraTracks')
    let extra = []
    try { extra = JSON.parse(extraRaw || '[]') } catch {}
    const filtered = extra.filter(x => x && x.url !== url)
    localStorage.setItem('extraTracks', JSON.stringify(filtered))
    
    // 从 overrideTracks 中移除
    const overrideRaw = localStorage.getItem('overrideTracks')
    try {
      const o = JSON.parse(overrideRaw || '[]')
      const of = Array.isArray(o) ? o.filter(x => x && x.url !== url) : []
      localStorage.setItem('overrideTracks', JSON.stringify(of))
    } catch {}
    
    // 注意：不在这里调用 setTracks 和 loadManifest，避免重复操作
  }

  // 执行删除逻辑
  const executeDelete = async () => {
    const url = pendingDeleteUrl
    setPendingDeleteUrl('')
    setPendingDeleteName('')
    
    // 立即从UI中移除歌曲，提供即时反馈
    setTracks(prevTracks => prevTracks.filter(t => t.url !== url))
    
    // 同时从本地存储中移除，确保数据一致性
    persistRemoveByUrl(url)
    
    // 计算仓库内路径：本地 /music/ 路径映射为 public/music/...
    const computeFilePath = (u) => {
      if (!u) return ''
      if (u.startsWith('/public/music/')) return u.replace(/^\//, '')
      if (u.startsWith('/music/')) return `public${u}`.replace(/^\//, '')
      return ''
    }
    // 展示进度
    setProgressOpen(true)
    setProgressTitle('删除中')
    setProgressMessage('正在从仓库删除文件...')
    setProgressValue(10)
    try {
      const filePath = computeFilePath(url)
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, rawUrl: url })
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`删除失败：${res.status} ${t}`)
      }
      setProgressValue(80)
      setProgressTitle('完成')
      setProgressMessage('已从仓库删除并同步到列表')
      setProgressValue(100)
    } catch (e) {
      console.error(e)
      setProgressTitle('失败')
      setProgressMessage(e.message || '删除失败')
      // 如果删除失败，重新加载数据以恢复歌曲
      loadManifest()
    } finally {
      setTimeout(() => setProgressOpen(false), 800)
    }
  }

  // 过滤歌曲（在任何条件返回之前，保持 Hooks 顺序稳定）
  const normalized = (s) => (s || '').toLowerCase()
  const filteredTracks = tracks.filter(t => {
    if (!query.trim()) return true
    const title = t.title || ''
    return normalized(title).includes(normalized(query))
  })

  // 保证索引在过滤结果内（Hook 必须始终调用）
  useEffect(() => {
    if (currentIndex >= filteredTracks.length) {
      setCurrentIndex(0)
    }
  }, [query, filteredTracks.length])

  if (loading) return null
  if (error) return <div className="container error">{error}</div>
  if (!tracks.length) return <div className="container">未发现音乐文件，请将音频放入 public/music</div>

  return (
    <div className="container">
      <Player tracks={filteredTracks} currentIndex={currentIndex} onChangeIndex={setCurrentIndex} forcePlayKey={forcePlayKey} onOpenSettings={() => setSettingsOpen(true)} />
      <SearchBar value={query} onChange={setQuery} />
      <Playlist
        tracks={filteredTracks}
        currentIndex={currentIndex}
        onSelect={(i) => { setCurrentIndex(i); setForcePlayKey(Date.now()) }}
        onDelete={(url) => {
          setPendingDeleteUrl(url)
          const track = tracks.find(t => t.url === url) || filteredTracks.find(t => t.url === url)
          const title = track?.title || ''
          // 兼容 "歌名   歌手" 或 "歌名 - 歌手" 两种格式
          const match = title.match(/^(.+?)(?:\s{2,}|\s-\s)(.+)$/)
          const display = match ? `${match[1].trim()} - ${match[2].trim()}` : title
          setPendingDeleteName(display)
          
          // 直接显示密码输入框
          setPasswordOpen(true)
        }}
      />
      <Password
        open={passwordOpen}
        title="删除歌曲"
        message={pendingDeleteName ? `确认删除：${pendingDeleteName}？` : '确认删除该歌曲吗？'}
        onCancel={() => { 
          setPasswordOpen(false)
          setPendingDeleteUrl('')
          setPendingDeleteName('')
          setPasswordErrorCount(0)
        }}
        onConfirm={() => {
          setPasswordOpen(false)
          // 执行删除逻辑
          executeDelete()
        }}
        onPasswordError={() => {
          setPasswordErrorCount(prev => prev + 1)
        }}
      />
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAddSong={async ({ songUrl, songTitle, fileName, mvUrl }) => {
          // 打开进度弹窗
          setProgressOpen(true)
          setProgressTitle('下载中')
          setProgressMessage('正在通过代理下载音频...')
          setProgressValue(5)
          // 优先尝试上传到 GitHub；失败或无凭据时，使用外链直接播放
          const repoFull = import.meta.env.VITE_GIT_REPO
          const token = import.meta.env.VITE_GIT_TOKEN
          const branch = import.meta.env.VITE_GIT_BRANCH || 'main'

          const tryUploadAndAdd = async () => {
            // 经由服务端代理拉取外部音频，避免浏览器端 CORS 限制
            const proxyRes = await fetch('/api/fetch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: songUrl })
            })
            if (!proxyRes.ok) {
              const text = await proxyRes.text()
              throw new Error(`代理获取失败: ${proxyRes.status} ${text}`)
            }
            const data = await proxyRes.json()
            const base64 = data.base64
            setProgressTitle('命名中')
            setProgressMessage(`生成文件名：${fileName}`)
            setProgressValue(40)

            const [owner, repo] = String(repoFull).split('/')
            if (!owner || !repo) throw new Error('VITE_GIT_REPO 格式应为 "owner/repo"')
            // URL-encode path segment to support non-ASCII filenames
            const encodedName = encodeURIComponent(fileName)
            const api = `https://api.github.com/repos/${owner}/${repo}/contents/public/music/${encodedName}`
            setProgressTitle('上传中')
            setProgressMessage('正在上传到 GitHub 仓库...')
            setProgressValue(60)
            const putRes = await fetch(api, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json'
              },
              body: JSON.stringify({
                message: `Add music: ${fileName}`,
                content: base64,
                branch
              })
            })
            if (!putRes.ok) {
              const text = await putRes.text()
              throw new Error(`上传失败: ${putRes.status} ${text}`)
            }
            // 上传成功后使用 GitHub raw 链接直接播放（无需等待站点同步静态文件）
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/public/music/${encodedName}`
            const newItem = { title: songTitle, url: rawUrl, mvUrl }
            setTracks(prev => {
              const idx = prev.findIndex(x => (x.title || '') === newItem.title)
              if (idx >= 0) {
                const next = [...prev]
                const prevItem = next[idx]
                const merged = { ...prevItem }
                if (!merged.mvUrl && newItem.mvUrl) merged.mvUrl = newItem.mvUrl
                next[idx] = merged
                return next
              }
              return [...prev, newItem]
            })
            persistAdd([newItem])
            // 清空搜索查询，确保新添加的歌曲立即可见
            setQuery('')
            setProgressValue(100)
            setProgressTitle('完成')
            setProgressMessage('上传成功，已添加到歌单')
            setTimeout(() => { setProgressOpen(false); setSettingsOpen(false) }, 800)
          }

          let fallbackError = null
          if (repoFull && token) {
            try {
              await tryUploadAndAdd()
              return
            } catch (e) {
              console.error(e)
              fallbackError = e
            }
          }

          // 无凭据或上传失败：直接使用外链 URL 播放
          const newItem = { title: songTitle, url: songUrl, mvUrl }
          setTracks(prev => {
            const idx = prev.findIndex(x => (x.title || '') === newItem.title)
            if (idx >= 0) {
              const next = [...prev]
              const prevItem = next[idx]
              const merged = { ...prevItem }
              if (!merged.mvUrl && newItem.mvUrl) merged.mvUrl = newItem.mvUrl
              next[idx] = merged
              return next
            }
            return [...prev, newItem]
          })
          persistAdd([newItem])
          // 清空搜索查询，确保新添加的歌曲立即可见
          setQuery('')
          setProgressTitle('完成')
          setProgressMessage((fallbackError && fallbackError.message) ? `无法上传到仓库，已使用外链播放：${fallbackError.message}` : '已使用外链播放（可能因网络或CORS限制无法上传）')
          setProgressValue(100)
          setTimeout(() => { setProgressOpen(false); setSettingsOpen(false) }, 1200)
        }}
        onImportRepo={async ({ gitRepo, gitToken, gitBranch, gitPath }) => {
          if (!gitRepo || !gitToken) return
          try {
            setProgressOpen(true)
            setProgressTitle('导入中')
            setProgressMessage('正在读取仓库文件列表...')
            setProgressValue(10)
            const branch = gitBranch || 'main'
            const [owner, repo] = String(gitRepo).split('/')
            if (!owner || !repo) throw new Error('GIT_REPO 格式应为 owner/repo')
            const normPath = String(gitPath || 'public/music').replace(/^\/+|\/+$/g, '') || '.'
            const segs = normPath === '.' ? [] : normPath.split('/').filter(Boolean)
            const pathPart = segs.length ? '/' + segs.map(encodeURIComponent).join('/') : ''
            const listApi = `https://api.github.com/repos/${owner}/${repo}/contents${pathPart}?ref=${encodeURIComponent(branch)}`
            const listRes = await fetch(listApi, { headers: { 'Authorization': `Bearer ${gitToken}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'web-music-player/0.1' } })
            if (!listRes.ok) {
              const t = await listRes.text()
              throw new Error(`读取仓库失败: ${listRes.status} ${t}`)
            }
            const items = await listRes.json()
            const allFiles = Array.isArray(items) ? items.filter(it => it && it.type === 'file') : []
            const audioExts = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm']
            const isExt = (name, exts) => exts.some(ext => name.toLowerCase().endsWith(ext))
            const audioFiles = allFiles.filter(it => isExt(it.name || '', audioExts))
            if (!audioFiles.length) {
              setProgressTitle('完成')
              setProgressMessage('未在该路径下发现音频文件')
              setProgressValue(100)
              setTimeout(() => setProgressOpen(false), 1200)
              return
            }
            setProgressMessage(`发现 ${audioFiles.length} 个音频文件，正在导入...`)
            setProgressValue(40)
            const added = []
            for (let i = 0; i < audioFiles.length; i++) {
              const it = audioFiles[i]
              const name = it.name || ''
              // 标题来源于文件名（使用同 manifest 的 toTitle 规则）
              const base = name.replace(/\.[^.]+$/, '')
              const title = base.replace(/\s*-\s*/g, ' - ').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim()
              const rawPathSegs = [...segs, name]
              const rawPath = rawPathSegs.map(encodeURIComponent).join('/')
              const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rawPath}`
              // 始终使用本项目内置封面（与 generate.mjs 顺序一致）
              const localPreferred = ['a.png','b.png','c.png','d.png','e.png','f.png','g.png','h.png','j.png','k.png','l.png','m.png','n.png','o.png','p.png','q.png','r.png','s.png','t.png','u.png']
              const cover = `/covers/${localPreferred[i % localPreferred.length]}`
              added.push({ title, url: rawUrl, cover })
              setProgressValue(40 + Math.floor(((i + 1) / audioFiles.length) * 50))
            }
            // 覆盖导入：直接替换列表并持久化为 overrideTracks
            localStorage.setItem('overrideTracks', JSON.stringify(added))
            setTracks(added)
            // 清空搜索查询，确保导入的歌曲立即可见
            setQuery('')
            setProgressTitle('完成')
            setProgressMessage('导入完成')
            setProgressValue(100)
          } catch (e) {
            console.error(e)
            setProgressTitle('失败')
            setProgressMessage(e.message || '导入失败')
          } finally {
            setTimeout(() => { setProgressOpen(false); setSettingsOpen(false) }, 1200)
          }
        }}
        onImportApi={async ({ apiUrl }) => {
          if (!apiUrl) return
          try {
            setProgressOpen(true)
            setProgressTitle('导入中')
            setProgressMessage('正在拉取 API 歌单...')
            setProgressValue(20)
            const base = String(apiUrl || '').trim()
            const normBase = base.replace(/\/$/, '')
            const candidates = [
              `${normBase}/api/music/list`
            ]
            let data = null
            let lastErr = null
            for (const url of candidates) {
              try {
                const resp = await fetch(url, { headers: { 'accept': 'application/json' } })
                if (!resp.ok) { lastErr = new Error(`HTTP ${resp.status}`); continue }
                const ct = resp.headers.get('content-type') || ''
                if (!/json/i.test(ct)) {
                  // 尝试按 JSON 解析（有些返回没有正确的 content-type）
                  try { data = await resp.json() } catch (e) { lastErr = new Error('非 JSON 响应'); continue }
                } else {
                  data = await resp.json()
                }
                // 命中后终止尝试
                if (data != null) break
              } catch (e) {
                lastErr = e
              }
            }
            if (data == null) throw new Error(lastErr ? lastErr.message : '无法获取到歌单，请提供 player 实例地址（形如 https://host），程序会请求 /api/music/list')
            // 仅支持 player 风格：{ total, data: [{ filename, url, ... }] }
            const isPlayerStyle = data && Array.isArray(data.data)
            if (!isPlayerStyle) {
              throw new Error('仅支持 player 风格 API：需返回 { total, data: [...] }')
            }
            const items = data.data
            const sanitized = []
            const localPreferred = ['a.png','b.png','c.png','d.png','e.png','f.png','g.png','h.png','j.png','k.png','l.png','m.png','n.png','o.png','p.png','q.png','r.png','s.png','t.png','u.png']
            for (let i = 0; i < items.length; i++) {
              const it = items[i] || {}
              if (!it.url) continue
              let title = it.title || it.name || ''
              if (!title && it.filename) {
                const base = String(it.filename).replace(/\.[^.]+$/, '')
                title = base.replace(/\s*-\s*/g, ' - ').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim()
              }
              if (!title) {
                title = `Track ${i + 1}`
              }
              const cover = `/covers/${localPreferred[i % localPreferred.length]}`
              sanitized.push({ title, url: it.url, cover })
            }
            if (!sanitized.length) throw new Error('API 未返回可用的歌曲项')
            // 覆盖导入：直接替换列表并持久化为 overrideTracks
            localStorage.setItem('overrideTracks', JSON.stringify(sanitized))
            setTracks(sanitized)
            // 清空搜索查询，确保导入的歌曲立即可见
            setQuery('')
            setProgressTitle('完成')
            setProgressMessage('API 歌单导入完成')
            setProgressValue(100)
          } catch (e) {
            console.error(e)
            setProgressTitle('失败')
            setProgressMessage(e.message || '导入失败')
          } finally {
            setTimeout(() => { setProgressOpen(false); setSettingsOpen(false) }, 1200)
          }
        }}
        onResetPlaylist={async () => {
          try {
            // 清空用户覆盖与新增
            localStorage.removeItem('overrideTracks')
            localStorage.removeItem('extraTracks')
          } catch {}
          setQuery('')
          await loadManifest()
          setCurrentIndex(0)
          setSettingsOpen(false)
        }}
      />
      <Progress
        open={progressOpen}
        title={progressTitle}
        message={progressMessage}
        progress={progressValue}
        onCancel={() => setProgressOpen(false)}
      />
      <footer>
        <a href="https://github.com/" target="_blank" rel="noreferrer">开源</a>
      </footer>
    </div>
  )
}


