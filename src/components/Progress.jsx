export default function Progress({
  currentTime,
  duration,
  buffered = 0,
  fullyBuffered = false,
  onSeekChange,
}) {
  const formattedTime = (sec) => {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, '0');
    const r = (s % 60).toString().padStart(2, '0');
    return `${m}:${r}`;
  };

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = fullyBuffered
    ? 100
    : duration
      ? Math.min(100, (buffered / duration) * 100)
      : 0;

  return (
    <div className="progress-under">
      <span className="time-left">{formattedTime(currentTime)}</span>
      <div className="progress-wrapper">
        <div
          className="progress-buffered"
          style={{ width: `${bufferedPercent}%` }}
          aria-hidden="true"
        />
        <input
          className="progress-line"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          onChange={onSeekChange}
          aria-label="播放进度"
          id="progress-slider"
          name="progress"
          style={{ '--p': `${progressPercent}%` }}
        />
      </div>
      <span className="time-right">{formattedTime(duration)}</span>
    </div>
  );
}
