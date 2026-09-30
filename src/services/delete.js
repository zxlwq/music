import * as api from './api';

/**
 * @param {string} url
 * @param {string} passwordValue
 * @param {(url: string) => void} removeFromPlaylist 同步移除列表并保持在播下标，避免误切歌
 * @param {(url: string, tracks: unknown[]) => void} persistRemoveByUrl
 * @param {unknown[]} tracks
 * @param {(url: string) => void} clearAudioCache
 * @param {(v: boolean) => void} setProgressOpen
 * @param {(v: string) => void} setProgressTitle
 * @param {(v: string) => void} setProgressMessage
 * @param {(v: number) => void} setProgressValue
 * @param {(e: unknown, ctx: string) => void} handleError
 * @param {() => void} loadManifestData
 */
export const executeDelete = async (
  url,
  passwordValue,
  removeFromPlaylist,
  persistRemoveByUrl,
  tracks,
  clearAudioCache,
  setProgressOpen,
  setProgressTitle,
  setProgressMessage,
  setProgressValue,
  handleError,
  loadManifestData,
) => {
  removeFromPlaylist(url);
  persistRemoveByUrl(url, tracks);
  clearAudioCache(url);

  const computeFilePath = (u) => {
    if (!u) return '';
    if (u.startsWith('/public/music/')) return u.replace(/^\//, '');
    if (u.startsWith('/music/')) return `public${u}`.replace(/^\//, '');
    return '';
  };

  setProgressOpen(true);
  setProgressTitle('删除中');
  setProgressMessage('正在从仓库删除文件...');
  setProgressValue(10);

  try {
    const filePath = computeFilePath(url);
    const shouldServerDelete = (() => {
      if (filePath) return true;
      try {
        const u = new URL(url);
        return u.hostname === 'raw.githubusercontent.com';
      } catch {
        return false;
      }
    })();

    if (shouldServerDelete) {
      await api.deleteTrack(filePath, url, passwordValue);
      setProgressValue(80);
      setProgressTitle('完成');
      setProgressMessage('已从仓库删除并同步到列表');
      setProgressValue(100);
      clearAudioCache(url);
    } else {
      setProgressValue(80);
      setProgressTitle('完成');
      setProgressMessage('已从列表移除（外链/本地临时资源无需仓库删除）');
      setProgressValue(100);
    }
  } catch (e) {
    handleError(e, '删除歌曲');
    setProgressTitle('失败');
    setProgressMessage(e.message || '删除失败');
    loadManifestData();
  }
};
