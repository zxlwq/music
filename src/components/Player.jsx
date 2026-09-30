import { useCallback, useEffect, useRef, useState } from 'react';
import CoverArt from './CoverArt';
import Controls from './Controls';
import Progress from './Progress';
import { useAudioCache } from '../hooks/Cache';
import { useAudioReactive } from '../hooks/aura';
import { fetchAppConfig } from '../services/config';
import { isBrowserOffline } from '../utils/network';

const LOOP_MODES = ['off', 'one'];

export default function Player({
  tracks,
  currentIndex,
  onChangeIndex,
  forcePlayKey,
  onOpenSettings,
  onExitNoMatch,
}) {
  const audioRef = useRef(null);
  const playerPanelRef = useRef(null);
  const seekTimeoutRef = useRef(null);
  const isSeekingRef = useRef(false);
  const preloadAudioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /** 曲首起连续缓冲比例 0~1（新缓冲条专用，不再用秒数+RAF） */
  const [bufferRatio, setBufferRatio] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loopMode, setLoopMode] = useState('off');
  const [shuffle, setShuffle] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [_audioLoadTimeout, setAudioLoadTimeout] = useState(false);
  const userVolumeRef = useRef(1);
  const userMutedRef = useRef(false);
  const loadTimeoutRef = useRef(null);
  const [appConfig, setAppConfig] = useState({
    customProxyUrl: '',
    hasCustomProxy: false,
  });

  const revokeBlobUrl = (blobUrl) => {
    if (!blobUrl || typeof blobUrl !== 'string' || !blobUrl.startsWith('blob:')) return;
    try {
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.warn('撤销 Blob URL 失败:', error);
    }
    blobUrlsRef.current.delete(blobUrl);
    if (currentBlobUrlRef.current === blobUrl) {
      currentBlobUrlRef.current = null;
    }
  };

  const clearCurrentBlobUrl = () => {
    if (currentBlobUrlRef.current) {
      revokeBlobUrl(currentBlobUrlRef.current);
    }
  };

  const audioContextRef = useRef(null);
  const blobUrlsRef = useRef(new Set());
  const currentBlobUrlRef = useRef(null);
  const testAudioRef = useRef(null);
  const bgCacheGenRef = useRef(0);
  const isCurrentTrackFullyCachedRef = useRef(false);
  /** 整文件拉取进度，与 media.buffered 取 max 驱动缓冲条 */
  const fetchBufferRatioRef = useRef(0);
  /** 切换代理重载音频时忽略 pause/play 事件，避免按钮与 CD 状态错乱 */
  const suppressPlayStateEventRef = useRef(false);
  /** 缓冲不足 waiting 时延迟同步暂停 UI，避免短暂卡顿闪烁 */
  const waitingUiTimerRef = useRef(null);

  const clearWaitingUiTimer = useCallback(() => {
    if (waitingUiTimerRef.current) {
      clearTimeout(waitingUiTimerRef.current);
      waitingUiTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearWaitingUiTimer(), [clearWaitingUiTimer]);

  const {
    isEnabled: cacheEnabled,
    smartPreload,
    getCachedAudio,
    getCachedAudioAsync,
    hasCachedAudio,
    cacheAudioWithProgress,
    setPlaybackPriority,
    isPlaybackPriority,
  } = useAudioCache();

  // 设置页开关/保存缓存后：立刻停填或按当前曲重启填充，无需整页刷新
  useEffect(() => {
    const onConfigApplied = (e) => {
      const enabled = e?.detail?.enabled;
      if (enabled === false) return;
      if (!Array.isArray(tracks) || !tracks.length) return;
      smartPreload(tracks, currentIndex);
    };
    window.addEventListener('audio-cache-config-applied', onConfigApplied);
    return () => window.removeEventListener('audio-cache-config-applied', onConfigApplied);
  }, [tracks, currentIndex, smartPreload]);

  const hasTracks = Array.isArray(tracks) && tracks.length > 0;
  const currentTrack = hasTracks ? tracks[currentIndex] : null;

  const parseTrackTitle = (title) => {
    if (!title) return { song: '', artist: '' };

    const match = title.match(/^(.+?)(?:\s{2,}|\s-\s)(.+)$/);
    if (match) {
      return { song: match[1].trim(), artist: match[2].trim() };
    }
    return { song: title, artist: '' };
  };

  const { song, artist } = parseTrackTitle(currentTrack?.title);

  useAudioReactive(audioRef, playerPanelRef, isPlaying);

  useEffect(() => {
    let dispose = () => {};

    const initAudioContext = async () => {
      try {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent,
        );
        const isChrome = /Chrome/i.test(navigator.userAgent);

        if (isMobile && window.AudioContext) {
          const AC = window.AudioContext || window.webkitAudioContext;
          audioContextRef.current = AC ? new AC() : null;

          const activateContext = async () => {
            try {
              if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
                console.log('音频上下文激活成功');
              }
            } catch (error) {
              console.warn('激活音频上下文失败:', error);
            }
          };

          const events = isChrome
            ? ['touchstart', 'touchend', 'click', 'keydown', 'mousedown', 'pointerdown']
            : ['touchstart', 'touchend', 'click', 'keydown'];

          const activateOnce = () => {
            activateContext();
            events.forEach((event) => {
              document.removeEventListener(event, activateOnce);
            });
          };

          events.forEach((event) => {
            document.addEventListener(event, activateOnce, { once: true, passive: true });
          });

          const handleVisibilityChange = () => {
            if (!document.hidden && audioContextRef.current?.state === 'suspended') {
              activateContext();
            }
          };
          document.addEventListener('visibilitychange', handleVisibilityChange);

          dispose = () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            events.forEach((event) => {
              document.removeEventListener(event, activateOnce);
            });
          };
        }
      } catch (error) {
        console.warn('音频上下文初始化失败:', error);
      }
    };

    void initAudioContext();
    return () => dispose();
  }, []);

  /** 本机开发态（localhost），用于「本地静态整曲」缓冲捷径 */
  const isDevLocalHost = useCallback(() => {
    try {
      const h = typeof location !== 'undefined' ? location.hostname : '';
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    } catch {
      return false;
    }
  }, []);

  /**
   * 可视为「整曲已在本地、缓冲条可直接满」的源：
   * - blob（内存/离线缓存）
   * - 仅 localhost 下的同源 /music 静态文件（Chrome 滑动 buffered 窗口会卡在约 70%）
   * 线上 CDN（如 Cloudflare Pages）的 /music 虽同源，仍应按真实 buffered 显示，并允许后台填充缓存。
   */
  const isLocalStaticAudio = useCallback(
    (audio) => {
      const src = String(audio?.currentSrc || audio?.src || '');
      if (!src) return false;
      if (src.startsWith('blob:')) return true;
      if (!isDevLocalHost()) return false;
      try {
        const u = new URL(src, typeof location !== 'undefined' ? location.href : 'http://local');
        if (typeof location !== 'undefined' && u.origin !== location.origin) return false;
        if (u.pathname.startsWith('/music/')) return true;
        if (u.pathname.startsWith('/api/')) return false;
        return /\.(mp3|m4a|flac|wav|ogg|aac|opus)(\?|$)/i.test(u.pathname);
      } catch {
        return false;
      }
    },
    [isDevLocalHost],
  );

  const isPlayingCachedBlobSource = useCallback((audio) => {
    return !!audio?.src?.startsWith?.('blob:');
  }, []);

  /** 当前曲缓冲是否已够「让路给预加载」 */
  const isPlayBufferHealthy = useCallback((audio) => {
    if (!audio) return false;
    if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) return true;
    if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return false;
    try {
      const t = Number(audio.currentTime) || 0;
      const d = Number(audio.duration);
      const ranges = audio.buffered;
      let end = 0;
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= t + 0.5 && t <= ranges.end(i) + 0.5) {
          end = ranges.end(i);
          break;
        }
      }
      if (end - t >= 8) return true;
      if (Number.isFinite(d) && d > 0 && end / d >= 0.12) return true;
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  const releasePlaybackPriorityIfHealthy = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (
      isPlayingCachedBlobSource(audio) ||
      isLocalStaticAudio(audio) ||
      isPlayBufferHealthy(audio)
    ) {
      setPlaybackPriority(false);
    }
  }, [isPlayBufferHealthy, isPlayingCachedBlobSource, isLocalStaticAudio, setPlaybackPriority]);

  /** 缓冲比例 0~1：本地整曲可 seek → 1；已绑定 blob 缓存 → 1；否则取含播放头的 range 末端 / 自 0 连续缓冲 */
  const readBufferRatio = useCallback(
    (audio) => {
      if (!audio) return 0;
      const d = audio.duration;
      if (!Number.isFinite(d) || d <= 0) return 0;

      // 仅当播放器已切到 blob 源时，才把「已缓存」视为整曲可快进
      if (isCurrentTrackFullyCachedRef.current && isPlayingCachedBlobSource(audio)) {
        return 1;
      }

      // 本地静态文件：seekable 覆盖全长时视为已全部可播（buffered 常是滑动窗口，会卡在 70%±）
      if (isLocalStaticAudio(audio) && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        try {
          const sk = audio.seekable;
          if (sk && sk.length > 0) {
            let seekEnd = 0;
            for (let i = 0; i < sk.length; i++) {
              if (sk.start(i) <= 0.35) seekEnd = Math.max(seekEnd, sk.end(i));
            }
            if (seekEnd >= d - 0.35) return 1;
          }
        } catch {
          /* ignore */
        }
        if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) return 1;
      }

      const ranges = audio.buffered;
      if (!ranges || ranges.length === 0) return 0;

      const t = Number(audio.currentTime) || 0;
      // 1) 含当前播放头的那段（适配浏览器滑动缓冲窗口）
      for (let i = 0; i < ranges.length; i++) {
        const start = ranges.start(i);
        const stop = ranges.end(i);
        if (start <= t + 0.5 && t <= stop + 0.5) {
          return Math.min(1, Math.max(0, stop / d));
        }
      }

      // 2) 自 0 起连续缓冲
      let end = 0;
      for (let i = 0; i < ranges.length; i++) {
        const start = ranges.start(i);
        const stop = ranges.end(i);
        if (start <= end + 0.75) {
          end = Math.max(end, stop);
        } else {
          break;
        }
      }
      if (end > 0) return Math.min(1, Math.max(0, end / d));

      // 3) 回退：最远缓冲点
      let maxEnd = 0;
      for (let i = 0; i < ranges.length; i++) {
        maxEnd = Math.max(maxEnd, ranges.end(i));
      }
      return Math.min(1, Math.max(0, maxEnd / d));
    },
    [isLocalStaticAudio, isPlayingCachedBlobSource],
  );

  const syncBufferRatio = useCallback(() => {
    const audio = audioRef.current;
    const media = readBufferRatio(audio);
    const fetchP = fetchBufferRatioRef.current || 0;
    let next = media;
    // 后台整文件下载进度可超前于 media.buffered，但未绑定 blob 前不标成「满缓冲可任意快进」
    if (isPlayingCachedBlobSource(audio) || isLocalStaticAudio(audio)) {
      next = Math.max(media, fetchP);
    } else if (fetchP > 0) {
      next = Math.max(media, Math.min(fetchP, 0.99));
    }
    setBufferRatio((prev) => (next > prev ? next : prev));
  }, [readBufferRatio, isPlayingCachedBlobSource, isLocalStaticAudio]);

  useEffect(() => {
    void fetchAppConfig().then(setAppConfig);
  }, []);

  const getAudioUrl = (track) => {
    if (!track?.url) return '';
    const audioLoadMethod = localStorage.getItem('ui.audioLoadMethod');
    const userCustomProxyUrl = localStorage.getItem('ui.customProxyUrl') || '';

    try {
      const u = new URL(track.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        if (audioLoadMethod === 'direct') {
          return track.url;
        } else if (audioLoadMethod === 'custom') {
          if (userCustomProxyUrl) {
            const finalProxyUrl =
              userCustomProxyUrl.endsWith('?') || userCustomProxyUrl.endsWith('&')
                ? userCustomProxyUrl
                : userCustomProxyUrl + (userCustomProxyUrl.includes('?') ? '&' : '?');
            return `${finalProxyUrl}url=${encodeURIComponent(track.url)}`;
          }
          // 环境变量代理不向前端暴露 URL；有配置时走服务端 customProxy 回退，首播用内置代理
          return `/api/audio?url=${encodeURIComponent(track.url)}`;
        } else {
          return `/api/audio?url=${encodeURIComponent(track.url)}`;
        }
      }
    } catch {}
    return track.url;
  };

  const getAudioUrlCandidates = (track) => {
    if (!track?.url) return [];
    return [
      getAudioUrl(track),
      track.url,
      `/api/audio?url=${encodeURIComponent(track.url)}`,
    ].filter(Boolean);
  };

  const restoreCachedAudio = async (track) => {
    if (!cacheEnabled || !track) return null;
    return getCachedAudioAsync(track, getAudioUrlCandidates(track));
  };

  const hasOfflineAudioCache = async (track) => {
    if (!cacheEnabled || !track) return false;
    return hasCachedAudio(track, getAudioUrlCandidates(track));
  };

  const getAudioCacheKey = (track) => `${track?.url || ''}_${track?.title || ''}`;

  const markFullyBufferedIfCached = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isPlayingCachedBlobSource(audio)) return;
    if (!isCurrentTrackFullyCachedRef.current) return;
    setBufferRatio(1);
  }, [isPlayingCachedBlobSource]);

  /**
   * 将内存/进度缓存得到的 blob 绑定到播放器，保留当前进度与播放状态。
   * 缓存条目可能是 { objectUrl, audio } 或已是带 blob src 的 Audio 元素。
   */
  const applyCachedSourceToPlayer = useCallback(
    (cached) => {
      const audio = audioRef.current;
      if (!audio || !cached) return false;

      const blobSrc =
        (typeof cached.objectUrl === 'string' && cached.objectUrl.startsWith('blob:')
          ? cached.objectUrl
          : '') ||
        (cached.audio?.src?.startsWith?.('blob:') ? cached.audio.src : '') ||
        (cached.src?.startsWith?.('blob:') ? cached.src : '');
      if (!blobSrc) return false;

      if (isPlayingCachedBlobSource(audio)) {
        isCurrentTrackFullyCachedRef.current = true;
        fetchBufferRatioRef.current = 1;
        setBufferRatio(1);
        markFullyBufferedIfCached();
        return true;
      }

      const resumeTime = Number(audio.currentTime) || 0;
      const wasPlaying = !audio.paused;
      const rate = audio.playbackRate || 1;

      try {
        audio.src = blobSrc;
        audio.load();
      } catch (e) {
        console.warn('切换到缓存音频失败:', e);
        return false;
      }

      let settled = false;
      const onReady = () => {
        if (settled) return;
        settled = true;
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('canplay', onReady);
        try {
          if (resumeTime > 0) {
            const d = audio.duration;
            audio.currentTime =
              Number.isFinite(d) && d > 0
                ? Math.min(resumeTime, Math.max(0, d - 0.05))
                : resumeTime;
          }
          audio.playbackRate = rate;
          if (wasPlaying) {
            void audio.play().catch(() => {});
          }
        } catch {
          /* ignore */
        }
        isCurrentTrackFullyCachedRef.current = true;
        fetchBufferRatioRef.current = 1;
        setBufferRatio(1);
        markFullyBufferedIfCached();
        syncBufferRatio();
      };

      audio.addEventListener('loadedmetadata', onReady);
      audio.addEventListener('canplay', onReady);
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        onReady();
      }
      return true;
    },
    [isPlayingCachedBlobSource, markFullyBufferedIfCached, syncBufferRatio],
  );

  useEffect(() => {
    const handleStorageChange = () => {
      const audio = audioRef.current;
      if (!audio || !currentTrack) return;

      // 缓存 blob / 本地静态源不受代理切换影响，避免无谓打断
      if (isPlayingCachedBlobSource(audio) || isLocalStaticAudio(audio)) {
        return;
      }

      const newUrl = getAudioUrl(currentTrack);
      if (!newUrl) return;

      let resolvedNew = newUrl;
      try {
        resolvedNew = new URL(newUrl, window.location.href).href;
      } catch {
        /* keep newUrl */
      }
      const currentSrc = audio.currentSrc || audio.src || '';
      if (currentSrc && currentSrc === resolvedNew) return;

      const resumeTime = Number(audio.currentTime) || 0;
      const wasPlaying = !audio.paused;
      const rate = audio.playbackRate || 1;

      suppressPlayStateEventRef.current = true;
      if (wasPlaying) {
        setIsPlaying(true);
      }

      try {
        audio.src = newUrl;
        audio.load();
      } catch (e) {
        suppressPlayStateEventRef.current = false;
        console.warn('切换代理后重新加载音频失败:', e);
        return;
      }

      let settled = false;
      const finish = () => {
        suppressPlayStateEventRef.current = false;
      };
      const onReady = () => {
        if (settled) return;
        settled = true;
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('canplay', onReady);
        try {
          if (resumeTime > 0) {
            const d = audio.duration;
            audio.currentTime =
              Number.isFinite(d) && d > 0
                ? Math.min(resumeTime, Math.max(0, d - 0.05))
                : resumeTime;
          }
          audio.playbackRate = rate;
          if (wasPlaying) {
            void audio
              .play()
              .then(() => {
                setIsPlaying(true);
              })
              .catch((err) => {
                console.warn('切换代理后恢复播放失败:', err);
                setIsPlaying(false);
              })
              .finally(finish);
          } else {
            setIsPlaying(false);
            finish();
          }
        } catch (e) {
          console.warn('切换代理后恢复进度失败:', e);
          finish();
        }
      };

      audio.addEventListener('loadedmetadata', onReady);
      audio.addEventListener('canplay', onReady);
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        onReady();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('audioSettingsChanged', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('audioSettingsChanged', handleStorageChange);
    };
  }, [currentTrack, isPlayingCachedBlobSource, isLocalStaticAudio]);

  const handleAudioError = async (e) => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const currentSrc = audio.src;

    console.warn('音频加载错误:', e);
    const isMobileChrome = /Android.*Chrome/i.test(navigator.userAgent);

    if (!currentSrc.startsWith('blob:')) {
      try {
        const cachedAudio = await restoreCachedAudio(currentTrack);
        if (cachedAudio?.src) {
          isCurrentTrackFullyCachedRef.current = true;
          audio.src = cachedAudio.src;
          audio.load();
          markFullyBufferedIfCached();
          return;
        }
      } catch (cacheError) {
        console.warn('Restore audio from offline cache failed:', cacheError);
      }
    }

    if (!currentSrc.includes('/api/audio')) {
      if (currentSrc.startsWith('blob:')) {
        clearCurrentBlobUrl();
      }

      try {
        const proxyUrl = `/api/audio?url=${encodeURIComponent(currentTrack.url)}`;
        console.log('Trying built-in audio proxy:', proxyUrl);

        if (isMobileChrome) {
          const directLoad = new Promise((resolve, reject) => {
            const testAudio = new Audio();
            testAudio.crossOrigin = 'anonymous';
            testAudio.preload = 'metadata';

            const cleanup = () => {
              testAudio.oncanplay = null;
              testAudio.onerror = null;
              testAudio.src = '';
              testAudio.load();
            };

            testAudio.oncanplay = () => {
              cleanup();
              resolve(true);
            };
            testAudio.onerror = () => {
              cleanup();
              reject(new Error('直接加载失败'));
            };
            testAudio.src = currentTrack.url;
            testAudio.load();

            setTimeout(() => {
              cleanup();
              reject(new Error('直接加载超时'));
            }, 8000);
          });

          try {
            await directLoad;
            audio.src = currentTrack.url;
            audio.load();
            return;
          } catch (directError) {
            console.log('直接加载失败，使用代理:', directError.message);
          }
        }

        let retryCount = 0;
        const maxRetries = 2;

        while (retryCount < maxRetries) {
          try {
            audio.src = proxyUrl;
            audio.load();

            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('代理加载超时'));
              }, 10000);

              const onCanPlay = () => {
                clearTimeout(timeout);
                audio.removeEventListener('canplay', onCanPlay);
                audio.removeEventListener('error', onError);
                resolve();
              };

              const onError = (error) => {
                clearTimeout(timeout);
                audio.removeEventListener('canplay', onCanPlay);
                audio.removeEventListener('error', onError);
                reject(error);
              };

              audio.addEventListener('canplay', onCanPlay);
              audio.addEventListener('error', onError);
            });

            console.log('通过代理成功加载');
            return;
          } catch (proxyError) {
            retryCount++;
            console.warn(`代理尝试 ${retryCount} 失败:`, proxyError.message);

            if (retryCount < maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
            }
          }
        }

        throw new Error('All proxy attempts failed');
      } catch (err1) {
        console.error('Built-in audio proxy failed:', err1);
      }
    }

    if (appConfig.hasCustomProxy && !isBrowserOffline()) {
      try {
        console.log('Built-in proxy failed, trying custom proxy via fetch.js');

        const timeout = 30000;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch('/api/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'customProxy',
            url: currentTrack.url,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data.base64 && data.contentType) {
            // Note: Large file processing via Worker removed - processLargeFileInWorker not defined
            // Files will be processed in main thread

            const binaryString = atob(data.base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: data.contentType });
            const blobUrl = URL.createObjectURL(blob);
            if (currentBlobUrlRef.current && currentBlobUrlRef.current !== blobUrl) {
              revokeBlobUrl(currentBlobUrlRef.current);
            }
            currentBlobUrlRef.current = blobUrl;
            blobUrlsRef.current.add(blobUrl);
            audio.src = blobUrl;
            audio.load();
            console.log('通过自定义代理成功加载音频');
            return;
          }
        } else {
          console.error('自定义代理响应异常:', response.status, response.statusText);
        }
      } catch (proxyError) {
        if (proxyError.name === 'AbortError') {
          console.error('自定义代理超时');
        } else {
          console.error('自定义代理也失败:', proxyError);
        }
      }
    }

    if (!currentSrc.includes(currentTrack.url)) {
      console.log('All methods failed, retrying original URL');
      audio.src = currentTrack.url;
      audio.load();
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = muted ? 0 : volume;
    userVolumeRef.current = volume;
    userMutedRef.current = muted;
  }, [volume, muted]);

  useEffect(() => {
    const handleAudioCacheUpdated = (event) => {
      if (!currentTrack) return;
      if (event.detail?.key !== getAudioCacheKey(currentTrack)) return;

      const cached = getCachedAudio(currentTrack);
      if (cached) {
        applyCachedSourceToPlayer(cached);
        return;
      }
      void restoreCachedAudio(currentTrack).then((restored) => {
        if (restored) applyCachedSourceToPlayer(restored);
      });
    };

    window.addEventListener('audio-cache-updated', handleAudioCacheUpdated);
    return () => {
      window.removeEventListener('audio-cache-updated', handleAudioCacheUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restoreCachedAudio 随 currentTrack 变化即可
  }, [currentTrack, getCachedAudio, applyCachedSourceToPlayer]);

  useEffect(() => {
    let cancelled = false;

    const syncOfflineBufferedState = async () => {
      if (!currentTrack || !cacheEnabled) return;

      const isCached = await hasOfflineAudioCache(currentTrack);
      if (cancelled || !isCached) return;

      const audio = audioRef.current;
      if (audio && isPlayingCachedBlobSource(audio)) {
        isCurrentTrackFullyCachedRef.current = true;
        markFullyBufferedIfCached();
        return;
      }

      try {
        const restored = await restoreCachedAudio(currentTrack);
        if (cancelled || !restored) return;
        applyCachedSourceToPlayer(restored);
      } catch {
        /* ignore */
      }
    };

    void syncOfflineBufferedState();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore/hasOffline 随 track URL 变化即可
  }, [currentTrack, cacheEnabled, applyCachedSourceToPlayer, markFullyBufferedIfCached]);

  useEffect(() => {
    // 保存 ref 的当前值到变量中，避免在清理函数中访问可能已改变的 ref
    const blobUrls = blobUrlsRef.current;
    return () => {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
      }
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }

      if (preloadAudioRef.current) {
        preloadAudioRef.current.src = '';
        preloadAudioRef.current.load();
        preloadAudioRef.current = null;
      }

      if (testAudioRef.current) {
        testAudioRef.current.src = '';
        testAudioRef.current.load();
        testAudioRef.current = null;
      }

      blobUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      blobUrls.clear();
      currentBlobUrlRef.current = null;

      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch (error) {
          console.warn('关闭音频上下文失败:', error);
        }
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hasTracks || tracks.length <= 1) return;

    const isMobileChrome = /Android.*Chrome/i.test(navigator.userAgent);
    const preloadDelay = isMobileChrome ? 3000 : 2000;

    const preloadTimer = setTimeout(() => {
      // 当前曲仍在抢带宽时不拉下一首 metadata，避免抢播放加载
      if (isPlaybackPriority()) return;
      const audio = audioRef.current;
      if (audio && !isPlayBufferHealthy(audio) && !isPlayingCachedBlobSource(audio)) return;

      const nextIndex = (currentIndex + 1) % tracks.length;
      const nextTrack = tracks[nextIndex];
      if (nextTrack && nextTrack.url) {
        const preloadUrl = getAudioUrl(nextTrack);

        if (preloadAudioRef.current) {
          preloadAudioRef.current.muted = true;
          preloadAudioRef.current.volume = 0;
          preloadAudioRef.current.src = preloadUrl;
          preloadAudioRef.current.preload = 'metadata';
          preloadAudioRef.current.crossOrigin = 'anonymous';

          if (isMobileChrome) {
            preloadAudioRef.current.addEventListener('error', (e) => {
              console.warn('Preload failed for next track:', e);
            });
          }

          preloadAudioRef.current.load();
        } else {
          const preloadAudio = new Audio();
          preloadAudio.muted = true;
          preloadAudio.volume = 0;
          preloadAudio.src = preloadUrl;
          preloadAudio.preload = 'metadata';
          preloadAudio.crossOrigin = 'anonymous';

          if (isMobileChrome) {
            const errorHandler = (e) => {
              console.warn('Preload failed for next track:', e);
              preloadAudio.removeEventListener('error', errorHandler);
            };
            preloadAudio.addEventListener('error', errorHandler);
          }

          preloadAudio.load();
          preloadAudioRef.current = preloadAudio;
        }
      }
    }, preloadDelay);

    return () => clearTimeout(preloadTimer);
  }, [
    currentIndex,
    tracks,
    hasTracks,
    isPlayBufferHealthy,
    isPlayingCachedBlobSource,
    isPlaybackPriority,
  ]);

  const play = async () => {
    const audio = audioRef.current;
    if (!audio) return Promise.reject(new Error('No audio element'));

    try {
      if (audio.readyState < 1) {
        await new Promise((resolve, _reject) => {
          const timeout = setTimeout(() => {
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('canplaythrough', onCanPlay);
            audio.removeEventListener('loadeddata', onCanPlay);
            audio.removeEventListener('loadstart', onCanPlay);

            if (audio.readyState < 1) {
              console.warn('音频在超时后仍未就绪，尝试继续播放');
              try {
                audio.load();
              } catch (loadError) {
                console.warn('重新加载音频失败:', loadError);
              }
              resolve();
            } else {
              resolve();
            }
          }, 5000);

          const onCanPlay = () => {
            clearTimeout(timeout);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('canplaythrough', onCanPlay);
            audio.removeEventListener('loadeddata', onCanPlay);
            audio.removeEventListener('loadstart', onCanPlay);
            resolve();
          };

          audio.addEventListener('canplay', onCanPlay);
          audio.addEventListener('canplaythrough', onCanPlay);
          audio.addEventListener('loadeddata', onCanPlay);
          audio.addEventListener('loadstart', onCanPlay);
        });
      }

      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      try {
        await audio.play();
        setIsPlaying(true);
        return Promise.resolve();
      } catch (playError) {
        console.warn('Audio play failed, but continuing:', playError.message);
        if (playError.name === 'NotSupportedError' || playError.name === 'NotAllowedError') {
          try {
            audio.load();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await audio.play();
            setIsPlaying(true);
            return Promise.resolve();
          } catch (retryError) {
            console.warn('Retry play failed:', retryError.message);
          }
        }
        setIsPlaying(false);
        return Promise.resolve();
      }
    } catch (e) {
      console.warn('Audio preparation failed:', e.message);
      setIsPlaying(false);
      return Promise.resolve();
    }
  };

  const pause = () => {
    audioRef.current.pause();
    setIsPlaying(false);
  };

  const togglePlay = () => {
    setHasInteracted(true);

    if (isPlaying) {
      pause();
    } else {
      const audio = audioRef.current;
      if (!audio) {
        console.warn('No audio element available');
        return;
      }

      if (audio.readyState >= 1) {
        play().catch((error) => {
          console.warn('Play failed:', error.message);
        });
      } else {
        console.log('Audio not ready, waiting for load...');
        const onCanPlay = () => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('loadeddata', onCanPlay);
          audio.removeEventListener('loadstart', onCanPlay);
          play().catch((error) => {
            console.warn('Play failed after load:', error.message);
          });
        };

        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('loadeddata', onCanPlay);
        audio.addEventListener('loadstart', onCanPlay);

        setTimeout(() => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('loadeddata', onCanPlay);
          audio.removeEventListener('loadstart', onCanPlay);

          play().catch((error) => {
            console.warn('超时后播放失败:', error.message);
          });
        }, 2000);
      }
    }
  };

  const onLoadedMetadata = () => {
    const a = audioRef.current;
    if (a && a.duration && !isNaN(a.duration) && a.duration > 0) {
      setDuration(a.duration);
      if (isCurrentTrackFullyCachedRef.current && isPlayingCachedBlobSource(a)) {
        setBufferRatio(1);
      }
    }

    setAudioLoadTimeout(false);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const onLoadedData = () => {
    const a = audioRef.current;
    if (a && a.duration && !isNaN(a.duration) && a.duration > 0) {
      setDuration(a.duration);
      if (isCurrentTrackFullyCachedRef.current && isPlayingCachedBlobSource(a)) {
        setBufferRatio(1);
      }
    }

    setAudioLoadTimeout(false);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const onCanPlay = () => {
    const a = audioRef.current;
    if (a && a.duration && !isNaN(a.duration) && a.duration > 0) {
      setDuration(a.duration);
      if (isCurrentTrackFullyCachedRef.current && isPlayingCachedBlobSource(a)) {
        setBufferRatio(1);
      }
    }

    setAudioLoadTimeout(false);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    releasePlaybackPriorityIfHealthy();
  };

  const onCanPlayThrough = () => {
    setPlaybackPriority(false);
  };

  const onSeeked = () => {
    if (isSeekingRef.current) return;

    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime || 0);
    }
    syncBufferRatio();
  };

  // 播放头：仅播放中刷新
  useEffect(() => {
    if (!isPlaying) return;

    const id = setInterval(() => {
      const a = audioRef.current;
      if (!a || isSeekingRef.current) return;
      setCurrentTime(a.currentTime || 0);
      if (!duration && a.duration && !isNaN(a.duration) && a.duration > 0) {
        setDuration(a.duration);
      }
    }, 120);

    return () => clearInterval(id);
  }, [isPlaying, duration]);

  // 缓冲：事件即时 + 轻量轮询（浏览器 progress 可能不连续）
  useEffect(() => {
    syncBufferRatio();
    const id = setInterval(syncBufferRatio, 250);
    return () => clearInterval(id);
  }, [syncBufferRatio, currentTrack?.url]);

  const seekChange = (e) => {
    const value = Number(e.target.value);

    isSeekingRef.current = true;

    setCurrentTime(value);

    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
    }

    seekTimeoutRef.current = setTimeout(() => {
      const audio = audioRef.current;
      if (audio && audio.readyState >= 2) {
        audio.currentTime = value;
        isSeekingRef.current = false;
      }
    }, 150);
  };

  const changeVolume = (e) => {
    const v = Number(e.target.value);
    setVolume(v);
    setMuted(v === 0);
    setHasInteracted(true);
  };

  const toggleMute = () => {
    setHasInteracted(true);
    setMuted((m) => !m);
  };

  const nextIndex = useCallback(() => {
    if (!tracks.length) return currentIndex;
    if (shuffle) {
      if (tracks.length <= 1) return currentIndex;
      let idx = currentIndex;
      while (idx === currentIndex) {
        idx = Math.floor(Math.random() * tracks.length);
      }
      return idx;
    }
    return (currentIndex + 1) % tracks.length;
  }, [currentIndex, tracks.length, shuffle]);

  const prevIndex = useCallback(() => {
    if (!tracks.length) return currentIndex;
    if (shuffle) return nextIndex();
    return (currentIndex - 1 + tracks.length) % tracks.length;
  }, [currentIndex, tracks.length, shuffle, nextIndex]);

  const playNext = () => {
    setHasInteracted(true);
    const nextIdx = nextIndex();
    if (nextIdx !== currentIndex) {
      onChangeIndex(nextIdx);
    }
  };

  const playPrev = () => {
    setHasInteracted(true);
    const prevIdx = prevIndex();
    if (prevIdx !== currentIndex) {
      onChangeIndex(prevIdx);
    }
  };

  const onEnded = () => {
    if (loopMode === 'one') {
      audioRef.current.currentTime = 0;
      play();
      return;
    }
    const idx = nextIndex();
    if (idx === currentIndex && !shuffle) {
      pause();
      return;
    }
    onChangeIndex(idx);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.url) return;

    const bgGen = ++bgCacheGenRef.current;
    const trackForLoad = currentTrack;
    const indexForLoad = currentIndex;
    let cancelled = false;
    let loadTimer = null;
    let playFallbackTimer = null;
    let playDelayTimer = null;
    let bgWaitTimer = null;
    let bgCacheOnCanPlay = null;
    let bgCacheOnCanPlayThrough = null;
    let bgAbort = null;

    // 切歌/首载：预加载让路，优先当前曲 <audio> 带宽
    setPlaybackPriority(true);

    setCurrentTime(0);
    setDuration(0);
    setBufferRatio(0);
    fetchBufferRatioRef.current = 0;
    isCurrentTrackFullyCachedRef.current = false;
    setAudioLoadTimeout(false);

    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }

    try {
      if (currentBlobUrlRef.current) {
        revokeBlobUrl(currentBlobUrlRef.current);
      }
      audio.pause();
      audio.currentTime = 0;

      audio.removeAttribute('src');
      audio.load();
    } catch {}

    const shouldAutoPlay = hasInteracted && isPlaying;
    let playCalled = false;

    const onCanPlay = () => {
      if (cancelled || playCalled || !shouldAutoPlay) return;
      playCalled = true;
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.removeEventListener('loadeddata', onCanPlay);
      playDelayTimer = setTimeout(() => {
        if (!cancelled) play().catch(() => {});
      }, 100);
    };

    loadTimer = setTimeout(async () => {
      if (cancelled || !audio) return;

      if (cacheEnabled && trackForLoad) {
        let cachedAudio = getCachedAudio(trackForLoad);

        if (!cachedAudio) {
          try {
            cachedAudio = await restoreCachedAudio(trackForLoad);
            if (cancelled) return;
            if (cachedAudio) {
              console.log('从 Cache Storage 恢复音频:', trackForLoad.title);
            }
          } catch (err) {
            console.warn('从 Cache Storage 恢复音频失败:', err);
          }
        } else {
          console.log('使用内存缓存的音频:', trackForLoad.title);
        }

        if (cancelled) return;

        let usedCache = false;
        if (cachedAudio) {
          isCurrentTrackFullyCachedRef.current = true;
          audio.src = cachedAudio.src;
          audio.load();
          markFullyBufferedIfCached();
          usedCache = true;
        } else {
          audio.src = getAudioUrl(trackForLoad);
          audio.load();
        }

        // 在线未缓存：监视 media 水位停拉，用整文件进度把缓冲条续上（显示层可修）
        const shouldFillOnStall = cacheEnabled && !usedCache && !isLocalStaticAudio(audio);

        if (shouldFillOnStall) {
          let bgRan = false;
          let bgWatching = false;
          const clearBgWait = () => {
            if (bgWaitTimer) {
              clearTimeout(bgWaitTimer);
              bgWaitTimer = null;
            }
          };

          const startProgressFill = () => {
            if (bgRan || cancelled || bgGen !== bgCacheGenRef.current) return;
            // 播放缓冲仍不足时先不双通道拉流，避免与 <audio> 抢带宽
            if (
              !isPlayBufferHealthy(audio) &&
              audio.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA
            ) {
              clearBgWait();
              bgWaitTimer = setTimeout(() => {
                if (!cancelled && !bgRan) startProgressFill();
              }, 500);
              return;
            }
            bgRan = true;
            clearBgWait();
            // 整文件补缓存期间继续压制邻曲预加载
            setPlaybackPriority(true);
            bgAbort = new AbortController();
            const mediaFloor = readBufferRatio(audio);
            fetchBufferRatioRef.current = Math.max(fetchBufferRatioRef.current, mediaFloor);
            const playSrc = audio.currentSrc || audio.src || getAudioUrl(trackForLoad);

            void cacheAudioWithProgress(
              trackForLoad,
              (p) => {
                if (cancelled || bgGen !== bgCacheGenRef.current) return;
                if (typeof p === 'number' && Number.isFinite(p)) {
                  fetchBufferRatioRef.current = Math.max(
                    fetchBufferRatioRef.current,
                    mediaFloor,
                    Math.min(1, p),
                  );
                  syncBufferRatio();
                }
              },
              bgAbort.signal,
              playSrc,
              Number.isFinite(audio.duration) && audio.duration > 0
                ? audio.duration * 16000
                : undefined,
            )
              .then((cached) => {
                if (cancelled || bgGen !== bgCacheGenRef.current) return;
                if (cached) {
                  // 后台整文件已写入：切到 blob，快进才无需再缓冲
                  applyCachedSourceToPlayer(cached);
                }
              })
              .finally(() => {
                if (cancelled || bgGen !== bgCacheGenRef.current) return;
                setPlaybackPriority(false);
                smartPreload(tracks, indexForLoad);
              });
          };

          const watchBufferStallThenFill = () => {
            if (bgWatching || bgRan || cancelled) return;
            bgWatching = true;

            let lastEnd = -1;
            let stableSince = Date.now();

            const tick = () => {
              if (cancelled || bgRan || bgGen !== bgCacheGenRef.current) return;
              const a = audio;
              const d = a.duration;
              if (!Number.isFinite(d) || d <= 0) {
                bgWaitTimer = setTimeout(tick, 400);
                return;
              }

              let bufferedEnd = 0;
              try {
                const ranges = a.buffered;
                for (let i = 0; i < ranges.length; i++) {
                  const start = ranges.start(i);
                  const stop = ranges.end(i);
                  if (start <= bufferedEnd + 0.75) {
                    bufferedEnd = Math.max(bufferedEnd, stop);
                  } else {
                    break;
                  }
                }
                if (bufferedEnd <= 0 && ranges.length) {
                  const t = Number(a.currentTime) || 0;
                  for (let i = 0; i < ranges.length; i++) {
                    if (ranges.start(i) <= t + 0.5 && t <= ranges.end(i) + 0.5) {
                      bufferedEnd = ranges.end(i);
                      break;
                    }
                  }
                }
              } catch {
                /* ignore */
              }

              syncBufferRatio();
              const ratio = bufferedEnd / d;

              if (ratio >= 0.97 || bufferedEnd >= d - 0.5) {
                startProgressFill();
                return;
              }

              const now = Date.now();
              // Chrome 水位停拉时 networkState 会变为 IDLE(1)
              const mediaIdle = a.networkState === HTMLMediaElement.NETWORK_IDLE && bufferedEnd > 2;

              if (bufferedEnd > lastEnd + 0.2) {
                lastEnd = bufferedEnd;
                stableSince = now;
                bgWaitTimer = setTimeout(tick, 300);
                return;
              }

              if (mediaIdle || (bufferedEnd > 2 && now - stableSince >= 800)) {
                startProgressFill();
                return;
              }

              bgWaitTimer = setTimeout(tick, 300);
            };

            tick();
          };

          bgCacheOnCanPlay = watchBufferStallThenFill;
          bgCacheOnCanPlayThrough = watchBufferStallThenFill;
          audio.addEventListener('canplay', bgCacheOnCanPlay, { once: true });
          audio.addEventListener('canplaythrough', bgCacheOnCanPlayThrough, {
            once: true,
          });
          if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            queueMicrotask(watchBufferStallThenFill);
          }
        } else if (cacheEnabled && usedCache) {
          // 已是缓存源，立刻让路并预加载邻曲
          setPlaybackPriority(false);
          smartPreload(tracks, indexForLoad);
        } else if (!cacheEnabled) {
          // 未开缓存：首段可播后释放优先闸门
          const onHealthy = () => {
            if (cancelled) return;
            releasePlaybackPriorityIfHealthy();
          };
          audio.addEventListener('canplay', onHealthy, { once: true });
          audio.addEventListener('playing', onHealthy, { once: true });
        }
      } else {
        audio.src = getAudioUrl(trackForLoad);
        audio.load();
        const onHealthy = () => {
          if (cancelled) return;
          releasePlaybackPriorityIfHealthy();
        };
        audio.addEventListener('canplay', onHealthy, { once: true });
        audio.addEventListener('playing', onHealthy, { once: true });
      }

      if (shouldAutoPlay) {
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('canplaythrough', onCanPlay);
        audio.addEventListener('loadeddata', onCanPlay);
        playFallbackTimer = setTimeout(() => {
          if (cancelled || playCalled) return;
          playCalled = true;
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('loadeddata', onCanPlay);
          play().catch(() => {});
        }, 2000);
      } else {
        audio.pause();
        queueMicrotask(() => {
          if (!cancelled) setIsPlaying(false);
        });
      }
    }, 50);

    return () => {
      cancelled = true;
      if (loadTimer) clearTimeout(loadTimer);
      if (playFallbackTimer) clearTimeout(playFallbackTimer);
      if (playDelayTimer) clearTimeout(playDelayTimer);
      if (bgWaitTimer) clearTimeout(bgWaitTimer);
      try {
        bgAbort?.abort();
      } catch {
        /* ignore */
      }
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.removeEventListener('loadeddata', onCanPlay);
      if (bgCacheOnCanPlay) audio.removeEventListener('canplay', bgCacheOnCanPlay);
      if (bgCacheOnCanPlayThrough) {
        audio.removeEventListener('canplaythrough', bgCacheOnCanPlayThrough);
      }
    };
    // 仅跟曲目 url：搜索 remap 同曲换 index 时不应重载；同 index 换曲必须重载
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tracks/index 仅用于预加载，不作为切歌条件
  }, [currentTrack?.url]);

  useEffect(() => {
    if (!forcePlayKey) return;
    if (!currentTrack) return;

    const id = setTimeout(() => {
      setHasInteracted(true);
      setIsPlaying(true);
      play();
    }, 100);
    return () => clearTimeout(id);
  }, [forcePlayKey, currentTrack]);

  const toggleLoopMode = () => {
    const idx = (LOOP_MODES.indexOf(loopMode) + 1) % LOOP_MODES.length;
    setLoopMode(LOOP_MODES[idx]);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.contentEditable === 'true'
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      if (e.key.startsWith('F') && e.key.length <= 3) {
        return;
      }

      if (e.key === 'F5' || e.code === 'F5') {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();

          playPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();

          playNext();
          break;
        case 'ArrowUp':
          e.preventDefault();

          const newVolume = Math.min(1, volume + 0.1);
          setVolume(newVolume);
          setMuted(false);
          break;
        case 'ArrowDown':
          e.preventDefault();

          const newVolume2 = Math.max(0, volume - 0.1);
          setVolume(newVolume2);
          if (newVolume2 === 0) {
            setMuted(true);
          }
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          onOpenSettings && onOpenSettings();
          break;
        case 'z':
        case 'Z':
          e.preventDefault();
          setShuffle((s) => !s);
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          toggleLoopMode();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- togglePlay/playNext/playPrev/toggleMute/toggleLoopMode 已在上方声明
  }, [
    volume,
    muted,
    shuffle,
    loopMode,
    tracks,
    currentIndex,
    onChangeIndex,
    onOpenSettings,
    isPlaying,
  ]);

  if (!hasTracks || !currentTrack) {
    return (
      <div className="player player-card">
        <div className="meta">
          <h2 className="track-title">无匹配结果</h2>
          <p className="track-sub">可修改搜索关键字，或返回完整歌单</p>
          {typeof onExitNoMatch === 'function' && (
            <button
              type="button"
              className="btn-sakura"
              style={{ marginTop: '14px' }}
              id="exit-no-match-btn"
              name="exit-no-match"
              onClick={() => onExitNoMatch()}
            >
              返回全部歌单
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="player player-card" ref={playerPanelRef}>
      <div className="audio-aura" aria-hidden="true" />
      <button
        className="settings-icon"
        aria-label="打开设置"
        onClick={onOpenSettings}
        id="settings-btn"
        name="settings"
      >
        ⚙️
      </button>
      <audio
        ref={audioRef}
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={onLoadedData}
        onCanPlay={onCanPlay}
        onCanPlayThrough={onCanPlayThrough}
        onSeeked={onSeeked}
        onEnded={onEnded}
        onPlay={() => {
          if (suppressPlayStateEventRef.current) return;
          setIsPlaying(true);
        }}
        onPause={() => {
          clearWaitingUiTimer();
          if (suppressPlayStateEventRef.current) return;
          setIsPlaying(false);
        }}
        onProgress={syncBufferRatio}
        onTimeUpdate={() => {
          syncBufferRatio();
          releasePlaybackPriorityIfHealthy();
        }}
        onWaiting={() => {
          syncBufferRatio();
          // 缓冲不足：压制预加载，带宽还给当前曲
          setPlaybackPriority(true);
          if (suppressPlayStateEventRef.current) return;
          clearWaitingUiTimer();
          // 缓冲不足时 media 往往仍非 paused，需主动把按钮与 CD 同步为暂停
          waitingUiTimerRef.current = setTimeout(() => {
            waitingUiTimerRef.current = null;
            if (suppressPlayStateEventRef.current) return;
            const a = audioRef.current;
            if (!a || a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
            setIsPlaying(false);
          }, 250);
        }}
        onStalled={() => {
          syncBufferRatio();
          setPlaybackPriority(true);
          if (suppressPlayStateEventRef.current) return;
          clearWaitingUiTimer();
          setIsPlaying(false);
        }}
        onPlaying={() => {
          syncBufferRatio();
          clearWaitingUiTimer();
          releasePlaybackPriorityIfHealthy();
          if (suppressPlayStateEventRef.current) return;
          setIsPlaying(true);
        }}
        onError={handleAudioError}
        preload="auto"
        crossOrigin="anonymous"
        playsInline
        webkit-playsinline="true"
        controls={false}
        muted={false}
        loop={false}
        x-webkit-airplay="allow"
        x-webkit-playsinline="true"
        style={{
          position: 'absolute',
          top: '-9999px',
          left: '-9999px',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      <div className="top">
        <CoverArt currentTrack={currentTrack} isPlaying={isPlaying} />
        <div className="meta">
          <h2 className="track-title">{artist ? `${song} - ${artist}` : song}</h2>
          <p className="track-sub">&nbsp;</p>
          <Controls
            isPlaying={isPlaying}
            shuffle={shuffle}
            loopMode={loopMode}
            volume={volume}
            muted={muted}
            onTogglePlay={togglePlay}
            onPlayPrev={playPrev}
            onPlayNext={playNext}
            onToggleShuffle={() => setShuffle((s) => !s)}
            onToggleLoop={toggleLoopMode}
            onVolumeChange={changeVolume}
            onToggleMute={toggleMute}
          />
        </div>
      </div>

      <Progress
        currentTime={currentTime}
        duration={duration}
        bufferRatio={bufferRatio}
        onSeekChange={seekChange}
      />
    </div>
  );
}
