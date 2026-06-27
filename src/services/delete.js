import * as api from './api';

export const executeDelete = async (
  url,
  passwordValue,
  tracks,
  setTracks,
  persistRemoveByUrl,
  clearAudioCache,
  setProgressOpen,
  setProgressTitle,
  setProgressMessage,
  setProgressValue,
  handleError,
  loadManifestData,
) => {
  setTracks((prevTracks) => prevTracks.filter((t) => t.url !== url));
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
  } finally {
    setTimeout(() => setProgressOpen(false), 800);
  }
};
