/**
 * 播放进度条（底轨 → 缓冲 → 已播）
 * bufferRatio: 0~1，已缓冲/可播比例
 */
export default function Progress({ currentTime = 0, duration = 0, bufferRatio = 0, onSeekChange }) {
  const format = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, '0');
    const r = (s % 60).toString().padStart(2, '0');
    return `${m}:${r}`;
  };

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const played = safeDuration ? Math.min(1, Math.max(0, currentTime / safeDuration)) : 0;
  const buffered = Math.min(1, Math.max(0, Number(bufferRatio) || 0));

  return (
    <div className="progress-under">
      <span className="time-left">{format(currentTime)}</span>
      <div className="progress-rail">
        <div className="progress-rail-base" aria-hidden="true" />
        <div
          className="progress-rail-buffer"
          aria-hidden="true"
          style={{ width: `${buffered * 100}%` }}
        />
        <div
          className="progress-rail-played"
          aria-hidden="true"
          style={{ width: `${played * 100}%` }}
        />
        <input
          className="progress-rail-input"
          type="range"
          min={0}
          max={safeDuration || 0}
          step={0.1}
          value={Math.min(currentTime, safeDuration) || 0}
          onChange={onSeekChange}
          aria-label="播放进度"
          id="progress-slider"
          name="progress"
          disabled={!safeDuration}
        />
      </div>
      <span className="time-right">{format(safeDuration)}</span>
    </div>
  );
}
