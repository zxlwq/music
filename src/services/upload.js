import * as api from './api';
import { persistAdd } from '../utils/storage';
import { getCoverUrlByIndex } from '../utils/covers';

export const executeUpload = async (
  songUrl,
  songTitle,
  fileName,
  mvUrl,
  base64,
  contentType,
  suppressClose,
  tracks,
  setTracks,
  query,
  setQuery,
  setProgressOpen,
  setProgressTitle,
  setProgressMessage,
  setProgressValue,
  setSettingsOpen,
  handleError,
  uploadTarget = 'github',
) => {
  setProgressOpen(true);
  setProgressTitle('下载中');
  setProgressMessage(base64 ? '使用本地音频数据...' : '正在通过代理下载音频...');
  setProgressValue(5);

  const tryUploadAndAdd = async () => {
    try {
      setProgressTitle('检查中');
      setProgressMessage('正在检查同名歌曲（按标题）...');
      const normalizeTitle = (s) =>
        String(s || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
      const existsByTitle = (tracks || []).some(
        (t) => normalizeTitle(t?.title) === normalizeTitle(songTitle),
      );
      if (existsByTitle) {
        setProgressTitle('失败');
        setProgressMessage('已存在同名歌曲');
        setProgressValue(100);
        return;
      }
    } catch {}

    let up;
    const isR2 = uploadTarget === 'r2';
    const isWebDAV = uploadTarget === 'webdav';
    const targetName = isR2 ? 'R2存储桶' : isWebDAV ? '云盘' : 'GitHub仓库';

    setProgressTitle('命名中');
    setProgressMessage(`生成文件名：${fileName}`);
    setProgressValue(40);
    setProgressTitle('上传中');
    setProgressMessage(`正在上传到 ${targetName}...`);
    setProgressValue(60);

    if (isR2) {
      // 优先使用直传（预签名 PUT）
      const tryDirectUpload = async () => {
        if (!base64 || typeof Blob === 'undefined') return null;
        // 将 base64 转为 Blob
        const byteChars = atob(base64);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const byteArray = new Uint8Array(byteNums);
        const blob = new Blob([byteArray], { type: contentType || 'application/octet-stream' });
        const ct = blob.type || 'application/octet-stream';

        const sign = await api.getR2UploadUrl(fileName, ct);
        await fetch(sign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': ct, ...(sign.headers || {}) },
          body: blob,
        });

        return {
          rawUrl: sign.accessUrl || `/api/r2?key=${encodeURIComponent(sign.key || fileName)}`,
        };
      };

      try {
        up = await tryDirectUpload();
      } catch (err) {
        console.warn('直传失败，回退表单上传:', err);
      }

      // 回退旧接口（兼容 sourceUrl / 代理下载场景）
      if (!up) {
        up = await api.uploadTrackToR2Json(
          base64 ? { fileName, base64 } : { fileName, sourceUrl: songUrl },
        );
      }
    } else if (isWebDAV) {
      if (base64 && typeof Blob !== 'undefined') {
        const byteChars = atob(base64);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const byteArray = new Uint8Array(byteNums);
        const blob = new Blob([byteArray], { type: contentType || 'application/octet-stream' });
        const form = new FormData();
        form.append('fileName', fileName);
        form.append('file', blob, fileName);
        up = await api.uploadTrackToWebDAV(form);
      } else {
        up = await api.uploadTrackToWebDAVJson(
          base64 ? { fileName, base64, contentType } : { fileName, sourceUrl: songUrl },
        );
      }
    } else {
      if (base64 && typeof Blob !== 'undefined') {
        const byteChars = atob(base64);
        const byteNums = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        const byteArray = new Uint8Array(byteNums);
        const blob = new Blob([byteArray], { type: contentType || 'application/octet-stream' });
        const form = new FormData();
        form.append('fileName', fileName);
        form.append('file', blob, fileName);
        up = await api.uploadTrack(form);
      } else {
        up = await api.uploadTrackJson(
          base64 ? { fileName, base64 } : { fileName, sourceUrl: songUrl },
        );
      }
    }

    const rawUrl = up.rawUrl;
    const timestampedUrl = rawUrl + (rawUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    const coverIdx = tracks.length;
    const assignedCover = getCoverUrlByIndex(coverIdx);
    const newItem = { title: songTitle, url: timestampedUrl, mvUrl, cover: assignedCover };

    try {
      const delRaw = localStorage.getItem('deletedUrls');
      const del = Array.isArray(JSON.parse(delRaw || '[]')) ? JSON.parse(delRaw || '[]') : [];
      const nd = del.filter((x) => x !== rawUrl);
      if (nd.length !== del.length) localStorage.setItem('deletedUrls', JSON.stringify(nd));
      const dtRaw = localStorage.getItem('deletedTitles');
      const dts = Array.isArray(JSON.parse(dtRaw || '[]')) ? JSON.parse(dtRaw || '[]') : [];
      const ntd = dts.filter((x) => x !== songTitle);
      if (ntd.length !== dts.length) localStorage.setItem('deletedTitles', JSON.stringify(ntd));
    } catch {}

    if (query.trim()) {
      setQuery('');
    }

    setTracks((prev) => {
      const idx = prev.findIndex((x) => (x.title || '') === newItem.title);
      if (idx >= 0) {
        const next = [...prev];
        const prevItem = next[idx];
        const merged = { ...prevItem };
        if (!merged.mvUrl && newItem.mvUrl) merged.mvUrl = newItem.mvUrl;
        if (!merged.cover && newItem.cover) merged.cover = newItem.cover;
        next[idx] = merged;
        return next;
      }
      return [...prev, newItem];
    });
    try {
      persistAdd([
        { title: newItem.title, url: newItem.url, cover: newItem.cover, mvUrl: newItem.mvUrl },
      ]);
    } catch {}

    setProgressValue(100);
    setProgressTitle('完成');
    setProgressMessage('上传成功，已添加到歌单');
    setTimeout(() => {
      setProgressOpen(false);
      if (!suppressClose) setSettingsOpen(false);
    }, 800);
  };

  try {
    await tryUploadAndAdd();
    return;
  } catch (e) {
    handleError(e, '上传歌曲');
    setProgressTitle('失败');
    setProgressMessage(e?.message || '上传失败');
    setProgressValue(100);
    return;
  }
};
