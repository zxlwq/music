import Icon from './Icon';

export default function Controls({
  isPlaying,
  shuffle,
  loopMode,
  volume,
  muted,
  onTogglePlay,
  onPlayPrev,
  onPlayNext,
  onToggleShuffle,
  onToggleLoop,
  onVolumeChange,
  onToggleMute,
}) {
  return (
    <div className="controls-row">
      <button
        className="icon-btn"
        onClick={onPlayPrev}
        aria-label="上一曲"
        id="prev-btn"
        name="prev"
      >
        <Icon name="prev" />
      </button>
      <button
        className="icon-btn icon-btn-primary"
        onClick={onTogglePlay}
        aria-label="播放/暂停"
        id="play-pause-btn"
        name="play-pause"
      >
        {isPlaying ? <Icon name="pause" /> : <Icon name="play" />}
      </button>
      <button
        className="icon-btn"
        onClick={onPlayNext}
        aria-label="下一曲"
        id="next-btn"
        name="next"
      >
        <Icon name="next" />
      </button>
      <button
        className="icon-btn"
        onClick={onToggleShuffle}
        aria-label="随机列表播放"
        aria-pressed={shuffle}
        id="shuffle-btn"
        name="shuffle"
      >
        <Icon name={shuffle ? 'shuffle_on' : 'shuffle'} />
      </button>
      <button
        className="icon-btn"
        onClick={onToggleLoop}
        aria-label="单曲循环"
        aria-pressed={loopMode !== 'off'}
        id="loop-btn"
        name="loop"
      >
        <Icon name={loopMode !== 'off' ? 'repeat_on' : 'repeat'} />
      </button>
      <div className="vol">
        <button
          className="icon-btn"
          onClick={onToggleMute}
          aria-label="静音"
          id="mute-btn"
          name="mute"
        >
          <Icon name={muted ? 'volume_muted' : 'volume'} />
        </button>
        <input
          className="vol-line"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          onChange={onVolumeChange}
          aria-label="音量"
          id="volume-slider"
          name="volume"
          style={{ '--p': `${(muted ? 0 : volume) * 100}%` }}
        />
      </div>
    </div>
  );
}
