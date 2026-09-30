import { useState, useEffect, useRef, useCallback } from 'react';
import audioCacheService from '../services/Audio';
import { saveAudioCacheToGist, loadAudioCacheFromGist } from '../services/api';
import { getAudioCachePreloadSettings, stripLegacyAudioCacheFields } from '../utils/Prefs';
import { isBrowserOffline, isOfflineError, logOfflineSkip } from '../utils/network';
import {
  getAudioCacheConfig,
  getAudioCacheEnabled,
  setAudioCacheConfig,
  setAudioCacheEnabled,
} from '../utils/localState';

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

  const [isEnabled, setIsEnabled] = useState(() => getAudioCacheEnabled());

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
      setAudioCacheEnabled(enabled);

      if (preloadTimeoutRef.current) {
        clearTimeout(preloadTimeoutRef.current);
        preloadTimeoutRef.current = null;
      }

      if (!enabled) {
        audioCacheService.stopPreloading();
      }

      updateCacheStats(true);
      window.dispatchEvent(
        new CustomEvent('audio-cache-config-applied', { detail: { enabled: Boolean(enabled) } }),
      );

      // 保存到 Gist（异步，不阻塞 UI）
      try {
        const config = stripLegacyAudioCacheFields(getAudioCacheConfig());

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

  const cacheAudioWithProgress = useCallback(
    async (track, onProgress, signal, preferredUrl, estimatedBytes) => {
      if (!isEnabled || !track) return null;
      try {
        return await audioCacheService.cacheAudioWithProgress(
          track,
          onProgress,
          signal,
          preferredUrl,
          estimatedBytes,
        );
      } catch (error) {
        console.warn('带进度缓存失败:', error);
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
    async (tracks, startIndex, count = 1) => {
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

  const setPlaybackPriority = useCallback((active) => {
    audioCacheService.setPlaybackPriority(active);
  }, []);

  const isPlaybackPriority = useCallback(() => audioCacheService.isPlaybackPriority(), []);

  const smartPreload = useCallback(
    async (tracks, currentIndex) => {
      if (!isEnabled || !tracks || !Array.isArray(tracks)) return;

      if (preloadTimeoutRef.current) {
        clearTimeout(preloadTimeoutRef.current);
      }

      const { preloadDelay } = getAudioCachePreloadSettings();

      const run = async () => {
        try {
          if (!getAudioCacheEnabled()) return;

          // 播放/切歌仍在抢带宽时延后预加载，避免堵当前曲
          if (audioCacheService.isPlaybackPriority()) {
            preloadTimeoutRef.current = setTimeout(run, Math.max(400, preloadDelay));
            return;
          }

          const { preloadCount: batchCount } = getAudioCachePreloadSettings();

          // 先预加载下一首和上一首（高优先级）
          await Promise.all([
            audioCacheService.preloadNext(tracks, currentIndex),
            audioCacheService.preloadPrev(tracks, currentIndex),
          ]);

          if (!getAudioCacheEnabled() || audioCacheService.isPlaybackPriority()) return;

          // 从当前曲起连续 batchCount 首入队（与设置「预加载数量」一致；URL 重复则由队列去重）
          await audioCacheService.preloadBatch(tracks, currentIndex, batchCount);

          if (!getAudioCacheEnabled() || audioCacheService.isPlaybackPriority()) return;

          // 获取当前缓存状态
          const stats = audioCacheService.getCacheStats();
          const remainingSlots = stats.maxCacheSize - stats.cacheSize;

          // 如果还有缓存空间，持续预加载直到达到最大缓存数量
          if (remainingSlots > 0) {
            audioCacheService.resetIdleFillBudget();
            await audioCacheService.preloadUntilFull(tracks, currentIndex);
          }

          updateCacheStats(true);
        } catch (error) {
          console.warn('智能预加载失败:', error);
        }
      };

      preloadTimeoutRef.current = setTimeout(run, preloadDelay);
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

  useEffect(() => {
    const onConfigApplied = (e) => {
      const enabled = e?.detail?.enabled;
      if (typeof enabled === 'boolean') {
        setIsEnabled(enabled);
      } else {
        setIsEnabled(getAudioCacheEnabled());
      }
      if (preloadTimeoutRef.current && enabled === false) {
        clearTimeout(preloadTimeoutRef.current);
        preloadTimeoutRef.current = null;
      }
      updateCacheStats(true);
    };
    window.addEventListener('audio-cache-config-applied', onConfigApplied);
    return () => window.removeEventListener('audio-cache-config-applied', onConfigApplied);
  }, [updateCacheStats]);

  // 监听 localStorage 中 enabled 状态的变化（用于从 Gist 加载后的同步）
  useEffect(() => {
    const checkEnabled = () => {
      const savedEnabled = getAudioCacheEnabled();
      if (savedEnabled !== isEnabled) {
        setIsEnabled(savedEnabled);
        if (!savedEnabled) {
          audioCacheService.stopPreloading();
          if (preloadTimeoutRef.current) {
            clearTimeout(preloadTimeoutRef.current);
            preloadTimeoutRef.current = null;
          }
          updateCacheStats(true);
        }
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
  }, [isEnabled, updateCacheStats]);

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
    cacheAudioWithProgress,
    getCachedAudio,
    getCachedAudioAsync,
    hasCachedAudio,
    preloadNext,
    preloadPrev,
    preloadBatch,
    smartPreload,
    setPlaybackPriority,
    isPlaybackPriority,
    updateCacheStats,
  };
}

export function useAudioCacheConfig() {
  const [config, setConfig] = useState(() => {
    const defaultConfig = {
      enabled: false,
      maxCacheSize: 50,
      preloadCount: 1,
      preloadDelay: 1000,
    };
    return stripLegacyAudioCacheFields({ ...defaultConfig, ...getAudioCacheConfig() });
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
            preloadCount: 1,
            preloadDelay: 1000,
          };

          const localConfig = getAudioCacheConfig();

          const mergedConfig = stripLegacyAudioCacheFields({
            ...defaultConfig,
            ...localConfig,
            ...(gistData.config || {}),
          });

          setConfig(mergedConfig);
          setAudioCacheConfig(mergedConfig);
          if (gistData.enabled !== undefined) {
            setAudioCacheEnabled(Boolean(gistData.enabled));
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
      setAudioCacheConfig(updatedConfig);

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
          enabled: getAudioCacheEnabled(),
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
