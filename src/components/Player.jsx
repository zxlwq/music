import { useCallback, useEffect, useRef, useState } from 'react';
import CoverArt from './CoverArt';
import Controls from './Controls';
import Progress from './Progress';
import { useAudioCache } from '../hooks/Cache';
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
  const seekTimeoutRef = useRef(null);
  const isSeekingRef = useRef(false);
  const preloadAudioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [fullyBuffered, setFullyBuffered] = useState(false);
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

  const {
    isEnabled: cacheEnabled,
    smartPreload,
    getCachedAudio,
    getCachedAudioAsync,
    hasCachedAudio,
    preloadAudio,
  } = useAudioCache();

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
          let proxyUrl;

          if (userCustomProxyUrl) {
            proxyUrl = userCustomProxyUrl;
          } else if (appConfig.customProxyUrl) {
            proxyUrl = appConfig.customProxyUrl;
          }

          if (proxyUrl) {
            const finalProxyUrl =
              proxyUrl.endsWith('?') || proxyUrl.endsWith('&')
                ? proxyUrl
                : proxyUrl + (proxyUrl.includes('?') ? '&' : '?');
            return `${finalProxyUrl}url=${encodeURIComponent(track.url)}`;
          } else {
            return `/api/audio?url=${encodeURIComponent(track.url)}`;
          }
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

  const computeBufferedTime = useCallback((audio) => {
    if (!audio || !audio.duration || isNaN(audio.duration) || audio.duration <= 0) {
      return 0;
    }
    // Prefer explicit buffered ranges when available. Do not assume
    // blob: sources are fully buffered to avoid false positives when
    // using proxies or service worker caching.
    if (audio.buffered && audio.buffered.length > 0) {
      const currentTime = audio.currentTime || 0;
      let maxBuffered = 0;
      for (let i = 0; i < audio.buffered.length; i++) {
        const bufferedEnd = audio.buffered.end(i);
        if (bufferedEnd > currentTime && bufferedEnd > maxBuffered) {
          maxBuffered = bufferedEnd;
        }
      }
      return Math.min(maxBuffered, audio.duration);
    }

    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      return Math.min((audio.currentTime || 0) + 1, audio.duration);
    }

    return 0;
  }, []);

  const computeFullyBuffered = useCallback((audio, bufferedTime) => {
    if (!audio || !audio.duration || isNaN(audio.duration) || audio.duration <= 0) {
      return false;
    }

    return bufferedTime >= audio.duration - 0.1;
  }, []);

  const isPlayingCachedBlobSource = useCallback((audio) => {
    return !!audio?.src?.startsWith?.('blob:');
  }, []);

  const markFullyBufferedIfCached = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isPlayingCachedBlobSource(audio)) return;

    const knownDuration =
      audio.duration && !isNaN(audio.duration) && audio.duration > 0 ? audio.duration : duration;

    if (isCurrentTrackFullyCachedRef.current && knownDuration > 0) {
      setBuffered(knownDuration);
      setFullyBuffered(true);
    }
  }, [duration, isPlayingCachedBlobSource]);

  useEffect(() => {
    const handleStorageChange = () => {
      if (currentTrack) {
        const audio = audioRef.current;
        if (audio) {
          const newUrl = getAudioUrl(currentTrack);
          if (audio.src !== newUrl) {
            audio.src = newUrl;
            audio.load();
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    window.addEventListener('audioSettingsChanged', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('audioSettingsChanged', handleStorageChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getAudioUrl 是稳定的函数引用，不需要添加
  }, [currentTrack]);

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

    if (appConfig.hasCustomProxy && appConfig.customProxyUrl && !isBrowserOffline()) {
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

      isCurrentTrackFullyCachedRef.current = true;
    };

    window.addEventListener('audio-cache-updated', handleAudioCacheUpdated);
    return () => {
      window.removeEventListener('audio-cache-updated', handleAudioCacheUpdated);
    };
  }, [currentTrack]);

  useEffect(() => {
    let cancelled = false;

    const syncOfflineBufferedState = async () => {
      if (!currentTrack) return;

      const isCached = await hasOfflineAudioCache(currentTrack);
      if (cancelled || !isCached) return;

      isCurrentTrackFullyCachedRef.current = true;
    };

    void syncOfflineBufferedState();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasOfflineAudioCache is derived from stable track URL candidates.
  }, [currentTrack, cacheEnabled, markFullyBufferedIfCached]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getAudioUrl 是稳定的函数引用，不需要添加
  }, [currentIndex, tracks, hasTracks]);

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
        setBuffered(a.duration);
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
        setBuffered(a.duration);
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
        setBuffered(a.duration);
      }
    }

    setAudioLoadTimeout(false);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const onSeeked = () => {
    if (isSeekingRef.current) return;

    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime || 0);
    }
  };

  const updateBuffered = useCallback(() => {
    const a = audioRef.current;
    const bufferedTime = computeBufferedTime(a);
    setBuffered(bufferedTime);
    setFullyBuffered(computeFullyBuffered(a, bufferedTime));
  }, [computeBufferedTime, computeFullyBuffered]);

  useEffect(() => {
    if (!isPlaying) return;

    const id = setInterval(() => {
      const a = audioRef.current;
      if (!a) return;

      if (isSeekingRef.current) return;
      setCurrentTime(a.currentTime || 0);
      updateBuffered();
      if (!duration && a.duration && !isNaN(a.duration) && a.duration > 0) {
        setDuration(a.duration);
      }
    }, 100);

    return () => clearInterval(id);
  }, [isPlaying, duration, updateBuffered]);

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
    if (!audio) return;

    const bgGen = ++bgCacheGenRef.current;

    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setFullyBuffered(false);
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

    setTimeout(async () => {
      if (audio) {
        if (cacheEnabled && currentTrack) {
          // 先尝试从内存缓存获取
          let cachedAudio = getCachedAudio(currentTrack);

          // 如果内存中没有，尝试从 Cache Storage 恢复
          if (!cachedAudio) {
            try {
              cachedAudio = await restoreCachedAudio(currentTrack);
              if (cachedAudio) {
                console.log('从 Cache Storage 恢复音频:', currentTrack.title);
              }
            } catch (err) {
              console.warn('从 Cache Storage 恢复音频失败:', err);
            }
          } else {
            console.log('使用内存缓存的音频:', currentTrack.title);
          }

          if (cachedAudio) {
            isCurrentTrackFullyCachedRef.current = true;
            audio.src = cachedAudio.src;
            audio.load();
            markFullyBufferedIfCached();
          } else {
            audio.src = getAudioUrl(currentTrack);
            audio.load();
          }

          // canplay 后再整文件缓存与邻曲预加载，避免与首包流媒体争抢带宽
          let bgRan = false;
          const runBgCache = () => {
            if (bgRan || bgGen !== bgCacheGenRef.current) return;
            bgRan = true;
            preloadAudio(currentTrack, 'high');
            smartPreload(tracks, currentIndex);
          };
          audio.addEventListener('canplay', runBgCache, { once: true });
          audio.addEventListener('canplaythrough', runBgCache, { once: true });
          if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            queueMicrotask(runBgCache);
          }
        } else {
          audio.src = getAudioUrl(currentTrack);
          audio.load();
        }
      }
    }, 50);

    if (hasInteracted && isPlaying) {
      let playCalled = false;

      const onCanPlay = () => {
        if (playCalled) return;
        playCalled = true;

        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('canplaythrough', onCanPlay);
        audio.removeEventListener('loadeddata', onCanPlay);

        setTimeout(() => {
          play().catch(() => {});
        }, 100);
      };

      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('canplaythrough', onCanPlay);
      audio.addEventListener('loadeddata', onCanPlay);

      setTimeout(() => {
        if (!playCalled) {
          playCalled = true;
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('loadeddata', onCanPlay);
          play().catch(() => {});
        }
      }, 2000);
    } else {
      audio.pause();
      queueMicrotask(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 这些依赖项是稳定的函数/变量，不需要添加
  }, [currentIndex]);

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
    <div className="player player-card">
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
        src={getAudioUrl(currentTrack)}
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={onLoadedData}
        onCanPlay={onCanPlay}
        onSeeked={onSeeked}
        onEnded={onEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onProgress={updateBuffered}
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
        buffered={buffered}
        fullyBuffered={fullyBuffered}
        onSeekChange={seekChange}
      />
    </div>
  );
}
