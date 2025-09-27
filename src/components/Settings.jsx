import React, { useEffect, useState } from 'react'

export default function Settings({ open, onClose, onAddSong, onImportRepo, onImportApi, onResetPlaylist }) {
  const [songUrl, setSongUrl] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [songMvUrl, setSongMvUrl] = useState('')
  const [gitRepo, setGitRepo] = useState('')
  const [gitToken, setGitToken] = useState('')
  const [gitBranch, setGitBranch] = useState('')
  const [gitPath, setGitPath] = useState('public/music')
  const [apiUrl, setApiUrl] = useState('')
  // 美化设置
  const [fontFamily, setFontFamily] = useState('')
  const [bgUrl, setBgUrl] = useState('')
  const FONT_PRESETS = [
    { label: '系统默认', value: '' },
    { label: '宋体', value: "'SimSun', 'NSimSun', 'Songti SC', serif" },
    { label: '楷体', value: "'KaiTi', 'STKaiti', 'Kaiti SC', serif" },
    { label: '仿宋', value: "'FangSong', 'STFangsong', 'FangSong_GB2312', serif" },
    { label: '黑体', value: "'SimHei', 'Heiti SC', 'PingFang SC', 'Microsoft YaHei', sans-serif" },
    { label: '微软雅黑', value: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif" },
    { label: '苹方', value: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif" },
    { label: '思源黑体', value: "'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif" }
  ]
  const [fontPreset, setFontPreset] = useState('')

  // 载入已保存的美化设置（打开弹窗时）
  useEffect(() => {
    if (!open) return
    try {
      setFontFamily(localStorage.getItem('ui.fontFamily') || '')
      setBgUrl(localStorage.getItem('ui.bgUrl') || '')
      const saved = localStorage.getItem('ui.fontFamily') || ''
      const matched = FONT_PRESETS.find(p => p.value === saved)
      setFontPreset(matched ? matched.value : '')
    } catch {}
  }, [open])

  const applyAppearance = ({ ff, bg }) => {
    const root = document.documentElement
    const body = document.body
    
    if (ff != null && root) {
      // 更新 CSS 变量，影响所有元素
      root.style.setProperty('--font-family', ff || 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial')
    }
    
    if (bg != null && body) {
      const base = "linear-gradient(180deg, rgba(0, 0, 0, .3), rgba(0, 0, 0, .3))"
      if (bg) {
        body.style.backgroundImage = `${base}, url('${bg}')`
      } else {
        // 清空以回退到样式表中的默认背景
        body.style.backgroundImage = ''
      }
    }
  }

  if (!open) return null

  const handleAddSong = () => {
    if (!songUrl || !songTitle) return
    // 统一标题格式：支持 "歌名   歌手"、"歌名 - 歌手"、或单空格，规范为 "歌名 - 歌手"
    const normalizedTitle = (() => {
      const raw = String(songTitle || '').trim()
      // 尝试匹配：多个空格 或 " - " 分隔
      const m = raw.match(/^(.+?)(?:\s{2,}|\s-\s)(.+)$/)
      if (m) return `${m[1].trim()} - ${m[2].trim()}`
      // 尝试匹配：单个空格分隔（尽量保守，避免英文歌名中间空格被误判）
      const single = raw.match(/^([^\s-].*?)\s([^\s].*?)$/)
      if (single) return `${single[1].trim()} - ${single[2].trim()}`
      return raw
    })()
    // Prefer filename from title, preserve CJK, fall back to random
    const urlStr = String(songUrl || '')
    const noQuery = urlStr.split('#')[0].split('?')[0]
    let ext = '.mp3'
    // try get extension from URL path
    try {
      const u = new URL(urlStr)
      const last = (u.pathname.split('/').filter(Boolean).pop() || '')
      const m = last.match(/\.[a-zA-Z0-9]{2,5}$/)
      if (m) ext = m[0]
    } catch (e) {
      const last = (noQuery.split('/').filter(Boolean).pop() || '')
      const m = last.match(/\.[a-zA-Z0-9]{2,5}$/)
      if (m) ext = m[0]
    }
    const baseRaw = normalizedTitle.trim()
    const base = baseRaw
      // remove illegal filename chars
      .replace(/[\/\\:*?"<>|]+/g, '')
      // collapse whitespace to single dash
      .replace(/\s+/g, '-')
      // collapse multiple dashes
      .replace(/-+/g, '-')
      // trim leading/trailing dots and dashes
      .replace(/^[.-]+|[.-]+$/g, '')
    const derived = base ? `${base}${ext}` : `audio-${Date.now()}${ext}`
    onAddSong && onAddSong({ songUrl, songTitle: normalizedTitle, fileName: derived, mvUrl: songMvUrl })
    setSongUrl('')
    setSongTitle('')
    setSongMvUrl('')
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title" style={{ textAlign: 'center' }}>设置</h3>
        <div className="modal-body">
          <div className="section-title">添加歌曲</div>
          <div className="form-group">
            <label className="form-label">歌曲URL</label>
            <input className="form-input" type="url" placeholder="https://player.zxlwq.dpdns.org.mp3" value={songUrl} onChange={(e) => setSongUrl(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">歌名-歌手</label>
              <input className="form-input" type="text" placeholder="歌名-歌手" value={songTitle} onChange={(e) => setSongTitle(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">MV 链接（可选）</label>
            <input className="form-input" type="url" placeholder="https://example.com/video" value={songMvUrl} onChange={(e) => setSongMvUrl(e.target.value)} />
          </div>
          <div className="form-actions" style={{ gap: 10 }}>
            <button type="button" className="btn-sakura" onClick={handleAddSong}>添加歌曲</button>
            <button type="button" className="btn-sakura" onClick={() => onResetPlaylist && onResetPlaylist()}>恢复默认</button>
          </div>
          <hr className="hr" />
          <div className="section-title">导入GitHub仓库歌曲</div>
          <div className="form-group">
            <label className="form-label">GIT_REPO</label>
            <input className="form-input" type="text" placeholder="用户名/仓库名" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">GIT_TOKEN</label>
            <input className="form-input" type="password" placeholder="GitHub Token" value={gitToken} onChange={(e) => setGitToken(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">GIT_BRANCH（可选）</label>
            <input className="form-input" type="text" placeholder="main" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">导入路径</label>
            <input className="form-input" type="text" placeholder="public/music 或 music 或 ." value={gitPath} onChange={(e) => setGitPath(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-sakura" onClick={() => onImportRepo && onImportRepo({ gitRepo, gitToken, gitBranch, gitPath })}>导入歌曲</button>
          </div>
          <hr className="hr" />
          <div className="section-title">导入API歌单</div>
          <div className="form-group">
            <label className="form-label">API链接</label>
            <input className="form-input" type="url" placeholder="https://player.zxlwq.dpdns.org" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-sakura" onClick={() => onImportApi && onImportApi({ apiUrl })}>导入歌曲</button>
          </div>
          <hr className="hr" />
          <div className="section-title">美化设置</div>
          <div className="form-group">
            <label className="form-label">字体预设</label>
            <select
              className="form-input"
              value={fontPreset}
              onChange={(e) => {
                const v = e.target.value
                setFontPreset(v)
                setFontFamily(v)
                try { localStorage.setItem('ui.fontFamily', v || '') } catch {}
                applyAppearance({ ff: v, bg: null })
              }}
            >
              {FONT_PRESETS.map(p => (
                <option key={p.label} value={p.value}>{p.label}</option>
              ))}
            </select>
            
          </div>
          <div className="form-group">
            <label className="form-label">背景图 URL</label>
            <input className="form-input" type="url" placeholder="https://jpg.zxla.dpdns.org/520.webp" value={bgUrl} onChange={(e) => setBgUrl(e.target.value)} />
            <div className="form-tip">留空恢复默认背景</div>
          </div>
          <div className="form-actions" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn-sakura"
              onClick={() => {
                try {
                  localStorage.setItem('ui.fontFamily', fontFamily || '')
                  localStorage.setItem('ui.bgUrl', bgUrl || '')
                } catch {}
                applyAppearance({ ff: fontFamily, bg: bgUrl })
              }}
            >应用并保存</button>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
