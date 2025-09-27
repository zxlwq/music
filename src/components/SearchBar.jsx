import React from 'react'

export default function SearchBar({ value, onChange }) {
  return (
    <div className="search-bar">
      <input
        type="text"
        className="search-input"
        placeholder="搜索歌曲或歌手"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="搜索歌曲"
      />
    </div>
  )
}


