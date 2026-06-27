import { useState, useEffect, useRef, useCallback } from 'react';
import audioCacheService from '../services/Audio';
import { saveAudioCacheToGist, loadAudioCacheFromGist } from '../services/api';
import { getAudioCachePreloadSettings, stripLegacyAudioCacheFields } from '../utils/Prefs';
import { isBrowserOffline, isOfflineError, logOfflineSkip } from '../utils/network';

export function useAudioCache(playlistTracks = null) {
  const [cacheStats, setCacheStats] = useState({
    cacheSize: 0,
    maxCacheSize: 50,
    /** 当前歌单在 Cache Storage 中已有离线副本的曲目数；undefined 表示尚未完成首次统计 */
    persistedCount: undefined,
    preloadQueueLength: 0,
    isPreloading: false,
    preloadCount: 0,
    preloadStartTime: 0,
  });

  const playlistSig = Array.isArray(playlistTracks)
    ? playlistTracks.map((track) => track?.url || '').join('\n')
    : '';

  const playlistTracksRef = useRef(playlistTracks);

  useEffect(() => {
    playlistTracksRef.current = playlistTracks;
  }, [playlistSig, playlistTracks]);

  const [isEnabled, setIsEnabled] = useState(() => {
    return localStorage.getItem('audioCache.enabled') !== 'false';
  });

  const preloadTimeoutRef = useRef(null);
  const statsTimerRef = useRef(null);

  const updateCacheStats = useCallback((immediate = false) => {
    const run = () => {
      const tracks = playlistTracksRef.current;
      const scopedStats =
        Array.isArray(tracks) && tracks.length
          ? audioCacheService.getCacheStatsForTracks(tracks)
          : audioCacheService.getCacheStats();
      setCacheStats((prev) => ({ ...prev, ...scopedStats }));

      const countPromise =
        Array.isArray(tracks) && tracks.length
          ? audioCacheService.countPersistedCacheForTracks(tracks)
          : audioCacheService.countPersistedCacheRequests();
      void countPromise.then((persistedCount) => {
        setCacheStats((prev) => ({ ...prev, persistedCount }));
      });
    };

    if (immediate) {
      if (statsTimerRef.current) {
        clearTimeout(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      run();
      return;
    }

    if (statsTimerRef.current) return;

    statsTimerRef.current = setTimeout(() => {
      statsTimerRef.current = null;
      run();
    }, 500);
  }, []);

  const toggleCache = useCallback(
    async (enabled) => {
      setIsEnabled(enabled);
      localStorage.setItem('audioCache.enabled', enabled.toString());
      updateCacheStats(true);

      // 保存到 Gist（异步，不阻塞 UI）
      try {
        const savedConfig = localStorage.getItem('audioCache.config');
        const config = savedConfig
          ? stripLegacyAudioCacheFields(JSON.parse(savedConfig))
          : {
              maxCacheSize: 50,
              preloadCount: 3,
              preloadDelay: 1000,
            };

        const audioCacheData = {
          enabled,
          config,
        };
        await saveAudioCacheToGist(audioCacheData);
      } catch (error) {
        console.warn('保存音频缓存状态到 Gist 失败:', error);
      }
    },
    [updateCacheStats],
  );

  const setMaxCacheSize = useCallback(
    (size) => {
      audioCacheService.setMaxCacheSize(size);
      updateCacheStats();
    },
    [updateCacheStats],
  );

  const clearCache = useCallback(() => {
    audioCacheService.clearCache();
    updateCacheStats(true);
  }, [updateCacheStats]);

  const preloadAudio = useCallback(
    async (track, priority = 'normal') => {
      if (!isEnabled || !track) return null;

      try {
        return await audioCacheService.preloadAudio(track, priority);
      } catch (error) {
        console.warn('预加载失败:', error);
        return null;
      }
    },
    [isEnabled],
  );

  const getCachedAudio = useCallback(
    (track) => {
      if (!isEnabled || !track) return null;

      return audioCacheService.getCachedAudio(track);
    },
    [isEnabled],
  );

  const getCachedAudioAsync = useCallback(
    async (track, audioUrls = []) => {
      if (!isEnabled || !track) return null;

      return await audioCacheService.getCachedAudioAsync(track, audioUrls);
    },
    [isEnabled],
  );

  const hasCachedAudio = useCallback(
    async (track, audioUrls = []) => {
      if (!isEnabled || !track) return false;

      return await audioCacheService.hasCachedAudio(track, audioUrls);
    },
    [isEnabled],
  );

  const preloadNext = useCallback(
    async (tracks, currentIndex) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      try {
        await audioCacheService.preloadNext(tracks, currentIndex);
        updateCacheStats();
      } catch (error) {
        console.warn('预加载下一首失败:', error);
      }
    },
    [isEnabled, updateCacheStats],
  );

  const preloadPrev = useCallback(
    async (tracks, currentIndex) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      try {
        await audioCacheService.preloadPrev(tracks, currentIndex);
        updateCacheStats();
      } catch (error) {
        console.warn('预加载上一首失败:', error);
      }
    },
    [isEnabled, updateCacheStats],
  );

  const preloadBatch = useCallback(
    async (tracks, startIndex, count = 3) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      try {
        await audioCacheService.preloadBatch(tracks, startIndex, count);
        updateCacheStats();
      } catch (error) {
        console.warn('批量预加载失败:', error);
      }
    },
    [isEnabled, updateCacheStats],
  );

  const smartPreload = useCallback(
    async (tracks, currentIndex) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      if (preloadTimeoutRef.current) {
        clearTimeout(preloadTimeoutRef.current);
      }

      const { preloadDelay } = getAudioCachePreloadSettings();

      preloadTimeoutRef.current = setTimeout(async () => {
        try {
          const { preloadCount: batchCount } = getAudioCachePreloadSettings();

          // 先预加载下一首和上一首（高优先级）
          await Promise.all([
            audioCacheService.preloadNext(tracks, currentIndex),
            audioCacheService.preloadPrev(tracks, currentIndex),
          ]);

          // 从当前曲起连续 batchCount 首入队（与设置「预加载数量」一致；URL 重复则由队列去重）
          await audioCacheService.preloadBatch(tracks, currentIndex, batchCount);

          // 获取当前缓存状态
          const stats = audioCacheService.getCacheStats();
          const remainingSlots = stats.maxCacheSize - stats.cacheSize;

          // 如果还有缓存空间，持续预加载直到达到最大缓存数量
          if (remainingSlots > 0) {
            audioCacheService.resetIdleFillBudget();
            await audioCacheService.preloadUntilFull(tracks, currentIndex);
          }

          updateCacheStats();
        } catch (error) {
          console.warn('智能预加载失败:', error);
        }
      }, preloadDelay);
    },
    [isEnabled, updateCacheStats],
  );

  useEffect(() => {
    updateCacheStats(true);
    const interval = setInterval(() => updateCacheStats(), 3000);
    return () => {
      clearInterval(interval);
      if (statsTimerRef.current) {
        clearTimeout(statsTimerRef.current);
        statsTimerRef.current = null;
      }
    };
  }, [updateCacheStats]);

  useEffect(() => {
    updateCacheStats(true);
  }, [playlistSig, updateCacheStats]);

  useEffect(() => {
    const onAudioCacheUpdated = () => updateCacheStats();
    window.addEventListener('audio-cache-updated', onAudioCacheUpdated);
    return () => window.removeEventListener('audio-cache-updated', onAudioCacheUpdated);
  }, [updateCacheStats]);

  // 监听 localStorage 中 enabled 状态的变化（用于从 Gist 加载后的同步）
  useEffect(() => {
    const checkEnabled = () => {
      const savedEnabled = localStorage.getItem('audioCache.enabled') !== 'false';
      if (savedEnabled !== isEnabled) {
        setIsEnabled(savedEnabled);
      }
    };

    // 初始检查
    checkEnabled();

    // 监听 storage 事件（跨标签页同步）
    const handleStorageChange = (e) => {
      if (e.key === 'audioCache.enabled') {
        checkEnabled();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // 定期检查（用于同标签页内的同步，因为 storage 事件只在跨标签页时触发）
    const interval = setInterval(checkEnabled, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [isEnabled]);

  useEffect(() => {
    return () => {
      if (preloadTimeoutRef.current) {
        clearTimeout(preloadTimeoutRef.current);
      }
    };
  }, []);

  return {
    cacheStats,
    isEnabled,

    toggleCache,
    setMaxCacheSize,
    clearCache,
    preloadAudio,
    getCachedAudio,
    getCachedAudioAsync,
    hasCachedAudio,
    preloadNext,
    preloadPrev,
    preloadBatch,
    smartPreload,
    updateCacheStats,
  };
}

export function useAudioCacheConfig() {
  const [config, setConfig] = useState(() => {
    const defaultConfig = {
      enabled: true,
      maxCacheSize: 50,
      preloadCount: 3,
      preloadDelay: 1000,
    };

    try {
      const saved = localStorage.getItem('audioCache.config');
      return saved
        ? stripLegacyAudioCacheFields({ ...defaultConfig, ...JSON.parse(saved) })
        : defaultConfig;
    } catch {
      return defaultConfig;
    }
  });

  const isSavingGistRef = useRef(false);

  // 从 Gist 加载配置（应用启动时）
  useEffect(() => {
    const loadFromGist = async () => {
      try {
        const gistData = await loadAudioCacheFromGist();
        if (gistData && typeof gistData === 'object') {
          const defaultConfig = {
            maxCacheSize: 50,
            preloadCount: 3,
            preloadDelay: 1000,
          };

          // 以 localStorage 为基础，再用 Gist 覆盖，避免 Gist 缺字段时把本地配置覆盖回默认值
          let localConfig = {};
          try {
            const saved = localStorage.getItem('audioCache.config');
            localConfig = saved ? JSON.parse(saved) : {};
          } catch {
            localConfig = {};
          }

          const mergedConfig = stripLegacyAudioCacheFields({
            ...defaultConfig,
            ...localConfig,
            ...(gistData.config || {}),
          });

          setConfig(mergedConfig);

          // 同步到 localStorage
          try {
            localStorage.setItem('audioCache.config', JSON.stringify(mergedConfig));
            if (gistData.enabled !== undefined) {
              localStorage.setItem('audioCache.enabled', gistData.enabled.toString());
            }
          } catch (e) {
            console.warn('保存到 localStorage 失败:', e);
          }
        }
      } catch (error) {
        if (isOfflineError(error)) {
          logOfflineSkip('从 Gist 加载音频缓存配置');
        } else {
          console.warn('从 Gist 加载音频缓存配置失败，使用本地数据:', error);
        }
      }
    };

    loadFromGist();
  }, []);

  const updateConfig = useCallback(
    async (newConfig) => {
      const updatedConfig = stripLegacyAudioCacheFields({ ...config, ...newConfig });
      setConfig(updatedConfig);

      // 保存到 localStorage
      try {
        localStorage.setItem('audioCache.config', JSON.stringify(updatedConfig));
      } catch (e) {
        console.warn('保存到 localStorage 失败:', e);
      }

      // 保存到 Gist（异步，不阻塞 UI）
      if (isSavingGistRef.current || isBrowserOffline()) {
        if (isBrowserOffline()) {
          logOfflineSkip('保存音频缓存配置到 Gist');
        }
        return;
      }

      isSavingGistRef.current = true;
      try {
        const audioCacheData = {
          enabled: localStorage.getItem('audioCache.enabled') !== 'false',
          config: updatedConfig,
        };
        await saveAudioCacheToGist(audioCacheData);
      } catch (error) {
        if (isOfflineError(error)) {
          logOfflineSkip('保存音频缓存配置到 Gist');
        } else {
          console.warn('保存音频缓存配置到 Gist 失败:', error);
        }
      } finally {
        isSavingGistRef.current = false;
      }
    },
    [config],
  );

  return {
    config,
    updateConfig,
  };
}
