/**
 * 与 `public/sw.js` 中 AUDIO_CACHE 常量名保持一致（页面与 SW 共用同一 Cache Storage 桶，避免重复整文件下载）。
 * 同源音频类请求（含 `/api/audio`、`/api/webdav/stream`、`/music/*` 等）由 sw.js 的 isAudioRequest 与 Range 逻辑处理。
 */
export const AUDIO_CACHE_BUCKET = 'music-player-audio';
