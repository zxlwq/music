import Icon from './Icon';

export default function Volume({ volume, muted, onVolumeChange, onToggleMute }) {
  return (
    <div className="vol">
      <button
        className="icon-btn"
        onClick={onToggleMute}
        aria-label="静音"
        id="mute-toggle-btn"
        name="mute-toggle"
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
        id="volume-control-slider"
        name="volume-control"
        style={{ '--p': `${(muted ? 0 : volume) * 100}%` }}
      />
    </div>
  );
}
