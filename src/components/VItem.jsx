export default function VItem({
  item,
  index,
  isVisible,
  isActive,
  onSelect,
  onDelete,
  onToggleFavorite,
  isFavorite = false,
}) {
  const parseTrackTitle = (title) => {
    if (!title) return { song: '', artist: '' };
    const match = title.match(/^(.+?)(?:\s{2,}|\s-\s)(.+)$/);
    if (match) {
      const song = match[1].trim();
      const artist = match[2].trim();
      return { song, artist };
    }
    return { song: title, artist: '' };
  };

  const { song, artist } = parseTrackTitle(item.title);

  const shareTrack = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const shareText = artist ? `${song} - ${artist}` : song;
    const url = item?.url || '';
    const shareData = { title: shareText, text: shareText, url };
    try {
      // 优先使用 Web Share API
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      } else if (navigator.share) {
        // 某些浏览器支持 share 但不支持 canShare
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      // 用户取消分享不算错误
      if (err.name === 'AbortError') {
        return;
      }
      console.warn('分享失败:', err);
    }

    // 降级方案：复制到剪贴板
    if (navigator.clipboard && url) {
      try {
        await navigator.clipboard.writeText(url);
        // 在移动端显示提示（如果可能）
        if (window.alert) {
          alert('链接已复制到剪贴板');
        } else {
          console.log('已复制分享链接:', url);
        }
      } catch (clipboardErr) {
        console.error('复制到剪贴板失败:', clipboardErr);
        // 最后的降级方案：在新窗口打开
        window.open(url, '_blank');
      }
    } else if (url) {
      // 如果剪贴板不可用，在新窗口打开
      window.open(url, '_blank');
    }
  };

  if (!isVisible) {
    return (
      <div
        className="playlist-item-placeholder"
        style={{
          height: '100%',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    );
  }

  return (
    <li
      className={`playlist-item ${isActive ? 'active' : ''}`}
      onClick={() => onSelect(index)}
      role="option"
      aria-selected={isActive}
    >
      <span className="index" style={{ color: 'var(--sub)' }}>
        {index + 1}
      </span>

      <span
        className="name"
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {artist ? `${song} - ${artist}` : song}
      </span>

      <div
        className="actions-inline"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        {item.mvUrl ? (
          <a
            className="download-link"
            href={item.mvUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`打开MV ${song}${artist ? ' - ' + artist : ''}`}
            style={{
              color: 'var(--sub)',
              textDecoration: 'none',
              fontSize: '13px',
              padding: '0',
              border: 'none',
              verticalAlign: 'baseline',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ff8fb3')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub)')}
          >
            MV
          </a>
        ) : null}

        <button
          type="button"
          className="favorite-btn"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite && onToggleFavorite(item.url, !isFavorite);
          }}
          aria-label={`${isFavorite ? '取消收藏' : '收藏'} ${song}${artist ? ' - ' + artist : ''}`}
          id={`favorite-btn-${item.url}`}
          name="favorite"
          style={{
            color: isFavorite ? '#ff8fb3' : 'var(--sub)',
            background: 'transparent',
            border: 'none',
            fontSize: '16px',
            padding: '0',
            cursor: 'pointer',
            verticalAlign: 'baseline',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (!isFavorite) {
              e.currentTarget.style.color = '#ff8fb3';
            }
          }}
          onMouseLeave={(e) => {
            if (!isFavorite) {
              e.currentTarget.style.color = 'var(--sub)';
            }
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={isFavorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        <button
          type="button"
          className="download-link"
          onClick={shareTrack}
          onTouchStart={(e) => {
            e.stopPropagation();
            shareTrack(e);
          }}
          aria-label={`分享 ${song}${artist ? ' - ' + artist : ''}`}
          id={`share-btn-${item.url}`}
          name="share"
          style={{
            color: 'var(--sub)',
            background: 'transparent',
            border: 'none',
            fontSize: '13px',
            padding: '4px 8px',
            cursor: 'pointer',
            verticalAlign: 'baseline',
            fontFamily: 'inherit',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            minWidth: '44px',
            minHeight: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff8fb3')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub)')}
        >
          分享
        </button>

        <button
          type="button"
          className="delete-link"
          onClick={(e) => {
            e.stopPropagation();
            onDelete && onDelete(item.url);
          }}
          aria-label={`删除 ${song}${artist ? ' - ' + artist : ''}`}
          id={`delete-btn-${item.url}`}
          name="delete"
          style={{
            color: 'var(--sub)',
            background: 'transparent',
            border: 'none',
            fontSize: '13px',
            padding: '0',
            cursor: 'pointer',
            verticalAlign: 'baseline',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff8fb3')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub)')}
        >
          删除
        </button>

        <button
          type="button"
          className="download-link"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const url = item?.url || '';
            if (!url) return;

            try {
              // 在Android WebView中，直接打开链接可能更可靠
              // 尝试使用 download 属性（如果支持）
              const link = document.createElement('a');
              link.href = url;
              link.download = `${song}${artist ? ' - ' + artist : ''}.mp3`;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);

              // 如果上面的方法失败，降级到直接打开
              setTimeout(() => {
                const opened = window.open(url, '_blank');
                if (!opened) {
                  // 如果弹窗被阻止，尝试使用 fetch 下载
                  fetch(url)
                    .then((res) => res.blob())
                    .then((blob) => {
                      const blobUrl = URL.createObjectURL(blob);
                      const link2 = document.createElement('a');
                      link2.href = blobUrl;
                      link2.download = `${song}${artist ? ' - ' + artist : ''}.mp3`;
                      document.body.appendChild(link2);
                      link2.click();
                      document.body.removeChild(link2);
                      URL.revokeObjectURL(blobUrl);
                    })
                    .catch((err) => {
                      console.error('下载失败:', err);
                      alert('下载失败，请检查网络连接');
                    });
                }
              }, 100);
            } catch (err) {
              console.error('下载失败:', err);
              // 最后的降级方案：直接打开链接
              window.open(url, '_blank');
            }
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            const url = item?.url || '';
            if (!url) return;
            // 在触摸设备上，直接打开链接
            window.open(url, '_blank');
          }}
          aria-label={`下载 ${song}${artist ? ' - ' + artist : ''}`}
          style={{
            color: 'var(--sub)',
            background: 'transparent',
            border: 'none',
            fontSize: '13px',
            padding: '4px 8px',
            cursor: 'pointer',
            verticalAlign: 'baseline',
            fontFamily: 'inherit',
            textDecoration: 'none',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            minWidth: '44px',
            minHeight: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff8fb3')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sub)')}
        >
          下载
        </button>
      </div>
    </li>
  );
}
