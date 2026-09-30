export default function SearchBar({ value, onChange, onSearch }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSearch && onSearch(value.trim());
    }
  };

  return (
    <div className="search-bar">
      <div className="audio-aura" aria-hidden="true" />
      <input
        type="text"
        className="search-input"
        placeholder="搜索"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="搜索歌曲"
        id="search-input"
        name="search"
      />
      <span className="search-hint" aria-hidden="true">
        回车搜索第三方音乐
      </span>
    </div>
  );
}
