import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function Icon({ name }) {
  const common = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24' }
  switch (name) {
    case 'prev':
      return (
        <svg {...common}>
          <polygon points="19 20 9 12 19 4 19 20"></polygon>
          <line x1="5" y1="19" x2="5" y2="5"></line>
        </svg>
      )
    case 'next':
      return (
        <svg {...common}>
          <polygon points="5 4 15 12 5 20 5 4"></polygon>
          <line x1="19" y1="5" x2="19" y2="19"></line>
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <polygon points="6 3 20 12 6 21 6 3"></polygon>
        </svg>
      )
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      )
    case 'repeat':
      return (
        <svg {...common}>
          <polyline points="17 1 21 5 17 9"></polyline>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
          <polyline points="7 23 3 19 7 15"></polyline>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
        </svg>
      )
    case 'repeat_on':
      return (
        <svg {...common}>
          <polyline points="17 1 21 5 17 9"></polyline>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
          <polyline points="7 23 3 19 7 15"></polyline>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          <text x="12" y="13.5" fill="currentColor" font-size="6" text-anchor="middle" font-weight="300">1</text>
        </svg>
      )
    case 'shuffle':
      return (
        <svg {...common}>
          <line x1="4" y1="7" x2="20" y2="7"></line>
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="17" x2="20" y2="17"></line>
        </svg>
      )
    case 'shuffle_on':
      return (
        <svg {...common}>
          <polyline points="16 3 21 3 21 8"></polyline>
          <line x1="4" y1="20" x2="21" y2="3"></line>
          <polyline points="21 16 21 21 16 21"></polyline>
          <line x1="15" y1="15" x2="21" y2="21"></line>
          <line x1="4" y1="4" x2="9" y2="9"></line>
        </svg>
      )
    case 'volume':
      return (
        <svg {...common}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
      )
    case 'volume_muted':
      return (
        <svg {...common}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="16" y1="8" x2="22" y2="14"></line>
          <line x1="22" y1="8" x2="16" y2="14"></line>
        </svg>
      )
    default:
      return null
  }
}

const LOOP_MODES = ['off', 'one']

export default function Player({ tracks, currentIndex, onChangeIndex, forcePlayKey, onOpenSettings }) {
  const audioRef = useRef(null)
  const seekTimeoutRef = useRef(null)
  const preloadAudioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [loopMode, setLoopMode] = useState('off')
  const [shuffle, setShuffle] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

  const hasTracks = Array.isArray(tracks) && tracks.length > 0
  const currentTrack = hasTracks ? tracks[currentIndex] : null
  
  // 解析歌曲标题，分离歌曲名和歌手
  const parseTrackTitle = (title) => {
    if (!title) return { song: '', artist: '' }
    // 兼容 "歌名   歌手"（多个空格）或 "歌名 - 歌手" 两种格式
    const match = title.match(/^(.+?)(?:\s{2,}|\s-\s)(.+)$/)
    if (match) {
      return { song: match[1].trim(), artist: match[2].trim() }
    }
    return { song: title, artist: '' }
  }
  
  const { song, artist } = parseTrackTitle(currentTrack?.title)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = muted ? 0 : volume
  }, [volume, muted])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current)
      }
    }
  }, [])

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 避免在输入框中触发快捷键
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') {
        return
      }
      
      // 避免影响系统快捷键（如F5刷新、Ctrl+R等）
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return
      }
      
      // 避免影响功能键（F1-F12等）
      if (e.key.startsWith('F') && e.key.length <= 3) {
        return
      }
      
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay().catch(console.warn)
          break
        case 'ArrowLeft':
          e.preventDefault()
          // 上一首
          playPrev()
          break
        case 'ArrowRight':
          e.preventDefault()
          // 下一首
          playNext()
          break
        case 'ArrowUp':
          e.preventDefault()
          // 音量增加
          const newVolume = Math.min(1, volume + 0.1)
          setVolume(newVolume)
          setMuted(false)
          break
        case 'ArrowDown':
          e.preventDefault()
          // 音量减少
          const newVolume2 = Math.max(0, volume - 0.1)
          setVolume(newVolume2)
          if (newVolume2 === 0) {
            setMuted(true)
          }
          break
        case 'm':
        case 'M':
          e.preventDefault()
          toggleMute()
          break
        case 's':
        case 'S':
          e.preventDefault()
          onOpenSettings && onOpenSettings()
          break
        case 'z':
        case 'Z':
          e.preventDefault()
          setShuffle(s => !s)
          break
        case 'r':
        case 'R':
          e.preventDefault()
          toggleLoopMode()
          break
      }
    }

    // 添加键盘事件监听器
    document.addEventListener('keydown', handleKeyDown)
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [volume, muted, shuffle, loopMode, tracks, currentIndex, onChangeIndex, onOpenSettings])

  // 移动端预加载下一首歌曲
  useEffect(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    if (!isMobile || !hasTracks || tracks.length <= 1) return

    // 预加载下一首歌曲
    const nextIndex = (currentIndex + 1) % tracks.length
    const nextTrack = tracks[nextIndex]
    if (nextTrack && nextTrack.url) {
      // 创建预加载音频元素
      if (preloadAudioRef.current) {
        preloadAudioRef.current.src = nextTrack.url
        preloadAudioRef.current.load()
      } else {
        const preloadAudio = new Audio()
        preloadAudio.src = nextTrack.url
        preloadAudio.preload = 'auto'
        preloadAudio.load()
        preloadAudioRef.current = preloadAudio
      }
    }
  }, [currentIndex, tracks, hasTracks])

  const formattedTime = (sec) => {
    const s = Math.floor(sec || 0)
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const r = (s % 60).toString().padStart(2, '0')
    return `${m}:${r}`
  }

  const play = async () => {
    const audio = audioRef.current
    if (!audio) return Promise.reject(new Error('No audio element'))
    
    try {
      // 检测移动端
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      
      // 移动端激进策略：不等待加载完成，直接尝试播放
      if (isMobile) {
        // 先暂停当前播放，避免重复播放
        audio.pause()
        
        // 移动端特殊处理：确保音频上下文激活
        if (audio.context && audio.context.state === 'suspended') {
          try {
            await audio.context.resume()
          } catch (e) {
            console.warn('Audio context resume failed:', e)
          }
        }
        
        // 立即尝试播放，不等待加载
        await audio.play()
        setIsPlaying(true)
        return Promise.resolve()
      } else {
        // 桌面端：使用原有策略
        if (audio.readyState < 2) {
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              audio.removeEventListener('canplay', onCanPlay)
              resolve() // 超时也继续播放
            }, 500)
            
            const onCanPlay = () => {
              clearTimeout(timeout)
              audio.removeEventListener('canplay', onCanPlay)
              resolve()
            }
            audio.addEventListener('canplay', onCanPlay)
          })
        }
        
        audio.pause()
        await audio.play()
        setIsPlaying(true)
        return Promise.resolve()
      }
    } catch (e) {
      // ignore autoplay rejection
      console.warn('Play failed:', e)
      setIsPlaying(false)
      return Promise.reject(e)
    }
  }

  const pause = () => {
    audioRef.current.pause()
    setIsPlaying(false)
  }


  const togglePlay = async () => {
    // 防抖处理，避免快速重复点击
    if (isToggling) return
    
    setHasInteracted(true)
    setIsToggling(true)
    
    try {
      if (isPlaying) {
        pause()
      } else {
        // 确保音频存在且可播放
        const audio = audioRef.current
        if (audio && audio.readyState >= 2) {
          await play()
        }
      }
    } finally {
      // 使用 setTimeout 确保状态更新完成后再允许下次切换
      setTimeout(() => setIsToggling(false), 100)
    }
  }

  const onLoadedMetadata = () => {
    setDuration(audioRef.current.duration || 0)
  }

  const onTimeUpdate = () => {
    setCurrentTime(audioRef.current.currentTime || 0)
  }

  const onSeeked = () => {
    // 音频时间设置完成后的回调
    const audio = audioRef.current
    if (audio) {
      setCurrentTime(audio.currentTime || 0)
    }
  }

  

  const seekChange = (e) => {
    const value = Number(e.target.value)
    
    // 立即更新UI状态，提供即时反馈
    setCurrentTime(value)
    
    // 防抖处理，避免频繁设置音频时间
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current)
    }
    
    seekTimeoutRef.current = setTimeout(() => {
      const audio = audioRef.current
      if (audio && audio.readyState >= 2) {
        // 使用requestAnimationFrame确保平滑设置
        requestAnimationFrame(() => {
          if (audio && audio.readyState >= 2) {
            audio.currentTime = value
          }
        })
      }
    }, 30) // 减少防抖延迟到30ms
  }

  const handleProgressJump = (e) => {
    if (!duration) return
    
    // 阻止事件冒泡，避免重复触发
    e.stopPropagation()
    
    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const newTime = ratio * duration
    
    // 立即更新UI状态，提供即时反馈
    setCurrentTime(newTime)
    
    // 优化音频时间设置，使用requestAnimationFrame确保平滑
    const audio = audioRef.current
    if (audio && audio.readyState >= 2) {
      // 使用requestAnimationFrame确保在下一帧设置音频时间
      requestAnimationFrame(() => {
        if (audio && audio.readyState >= 2) {
          audio.currentTime = newTime
        }
      })
    }
    
    setHasInteracted(true)
  }

  const handleProgressPress = (ev) => {
    if (!duration) return
    
    // 阻止默认行为，避免与onClick冲突
    ev.preventDefault()
    ev.stopPropagation()
    
    const e = ev.touches && ev.touches.length ? ev.touches[0] : ev
    const target = ev.currentTarget
    const rect = target.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const newTime = ratio * duration
    setCurrentTime(newTime)
    
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = newTime
    }
    setHasInteracted(true)
  }

  const changeVolume = (e) => {
    const v = Number(e.target.value)
    setVolume(v)
    setMuted(v === 0)
    setHasInteracted(true)
  }

  const toggleMute = () => { setHasInteracted(true); setMuted((m) => !m) }

  const nextIndex = useCallback(() => {
    if (!tracks.length) return currentIndex
    if (shuffle) {
      if (tracks.length <= 1) return currentIndex
      let idx = currentIndex
      while (idx === currentIndex) {
        idx = Math.floor(Math.random() * tracks.length)
      }
      return idx
    }
    return (currentIndex + 1) % tracks.length
  }, [currentIndex, tracks.length, shuffle])

  const prevIndex = useCallback(() => {
    if (!tracks.length) return currentIndex
    if (shuffle) return nextIndex()
    return (currentIndex - 1 + tracks.length) % tracks.length
  }, [currentIndex, tracks.length, shuffle, nextIndex])

  const playNext = () => { 
    setHasInteracted(true)
    const nextIdx = nextIndex()
    if (nextIdx !== currentIndex) {
      onChangeIndex(nextIdx)
    }
  }
  
  const playPrev = () => { 
    setHasInteracted(true)
    const prevIdx = prevIndex()
    if (prevIdx !== currentIndex) {
      onChangeIndex(prevIdx)
    }
  }

  const onEnded = () => {
    if (loopMode === 'one') {
      audioRef.current.currentTime = 0
      play()
      return
    }
    const idx = nextIndex()
    if (idx === currentIndex && !shuffle) {
      pause()
      return
    }
    onChangeIndex(idx)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    
    // 检测移动端
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    
    // 先暂停当前播放，避免冲突
    audio.pause()
    
    if (hasInteracted && isPlaying) {
      if (isMobile) {
        // 移动端激进优化：延迟重置状态，保持视觉连续性
        // 先加载音频，不立即重置进度条
        audio.load()
        
        // 使用更激进的播放策略
        const playImmediately = () => {
          // 立即尝试播放，不等待加载完成
          play().then(() => {
            // 播放成功后，延迟重置进度条，避免视觉跳跃
            setTimeout(() => {
              setCurrentTime(0)
              setDuration(0)
            }, 100)
          }).catch(() => {
            // 播放失败，等待音频加载
            const checkAndRetry = () => {
              if (audio.readyState >= 1) {
                play().then(() => {
                  setTimeout(() => {
                    setCurrentTime(0)
                    setDuration(0)
                  }, 50)
                })
              } else {
                setTimeout(checkAndRetry, 50)
              }
            }
            checkAndRetry()
          })
        }
        
        // 立即尝试播放
        playImmediately()
      } else {
        // 桌面端：使用原有策略
        setCurrentTime(0)
        setDuration(0)
        audio.load()
        const delay = audio.readyState >= 2 ? 50 : 150
        setTimeout(() => {
          play()
        }, delay)
      }
    } else {
      // 非播放状态：立即更新状态
      setCurrentTime(0)
      setDuration(0)
      audio.load()
      setIsPlaying(false)
    }
  }, [currentIndex])

  // 来自列表点击的强制播放信号
  useEffect(() => {
    if (!forcePlayKey) return
    if (!currentTrack) return
    
    setHasInteracted(true)
    setIsPlaying(true)
    
    // 统一延迟播放，避免与歌曲切换冲突
    setTimeout(() => {
      play()
    }, 100)
  }, [forcePlayKey, currentTrack])

  const toggleLoopMode = () => {
    const idx = (LOOP_MODES.indexOf(loopMode) + 1) % LOOP_MODES.length
    setLoopMode(LOOP_MODES[idx])
  }

  if (!hasTracks || !currentTrack) {
    return (
      <div className="player player-card">
        <div className="meta">
          <h2 className="track-title">无匹配结果</h2>
          <p className="track-sub">请调整搜索关键字</p>
        </div>
      </div>
    )
  }

  return (
    <div className="player player-card">
      <button className="settings-icon" aria-label="打开设置" title="设置" onClick={onOpenSettings}>⚙️</button>
      <audio
        ref={audioRef}
        src={currentTrack.url}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onSeeked={onSeeked}
        onEnded={onEnded}
        preload="auto"
        crossOrigin="anonymous"
        playsInline
        webkit-playsinline="true"
      />

       <div className="top">
         <div className={`art-lg ${isPlaying ? 'playing' : ''}`} aria-hidden="true">
           <div className={`disc ${isPlaying ? 'playing' : ''}`}>
            {currentTrack.cover ? (
              <img src={currentTrack.cover} alt="封面" loading="lazy" />
            ) : (
              <div className="art-fallback" />
            )}
          </div>
        </div>
        <div className="meta">
          <h2 className="track-title" title={artist ? `${song} - ${artist}` : song}>
            {artist ? `${song} - ${artist}` : song}
          </h2>
          <p className="track-sub">&nbsp;</p>
          <div className="controls-row">
            <button className="icon-btn" onClick={playPrev} aria-label="上一曲"><Icon name="prev" /></button>
            <button className="icon-btn icon-btn-primary" onClick={togglePlay} aria-label="播放/暂停">{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
            <button className="icon-btn" onClick={playNext} aria-label="下一曲"><Icon name="next" /></button>
            <button className="icon-btn" onClick={() => setShuffle(s => !s)} aria-label="随机列表播放" title={shuffle ? '随机列表播放：开' : '随机列表播放：关'} aria-pressed={shuffle}><Icon name={shuffle ? 'shuffle_on' : 'shuffle'} /></button>
            <button className="icon-btn" onClick={toggleLoopMode} aria-label="单曲循环" title={loopMode !== 'off' ? '单曲循环：开' : '单曲循环：关'} aria-pressed={loopMode !== 'off'}><Icon name={loopMode !== 'off' ? 'repeat_on' : 'repeat'} /></button>
            <div className="vol">
              <button className="icon-btn" onClick={toggleMute} aria-label="静音"><Icon name={muted ? 'volume_muted' : 'volume'} /></button>
              <input 
                className="vol-line" 
                type="range" 
                min="0" 
                max="1" 
                step="0.01" 
                value={muted ? 0 : volume} 
                onChange={changeVolume} 
                aria-label="音量"
                style={{ '--p': `${(muted ? 0 : volume) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="progress-under">
        <span className="time-left">{formattedTime(currentTime)}</span>
        <input
          className="progress-line"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={seekChange}
          onClick={handleProgressJump}
          aria-label="播放进度"
          style={{ '--p': `${duration ? (currentTime / duration) * 100 : 0}%` }}
        />
        <span className="time-right">{formattedTime(duration)}</span>
      </div>

      {/* 播放列表已分离到独立组件 */}
    </div>
  )
}


