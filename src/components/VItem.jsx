import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0, maxHeight: undefined });
  const triggerRef = useRef(null);
  const menuPanelRef = useRef(null);
  const menuId = useId();
  const favGradId = `fav-grad${useId().replace(/:/g, '')}`;

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

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const updateMenuPos = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = menuPanelRef.current;
    if (!trigger) return;

    const r = trigger.getBoundingClientRect();
    const shell =
      trigger.closest('.virtual-playlist-shell') || trigger.closest('.virtual-playlist');
    const bounds = shell?.getBoundingClientRect() || {
      top: 8,
      bottom: window.innerHeight - 8,
      right: window.innerWidth - 8,
    };
    const gap = 4;
    // 紧凑菜单预估高度：末行优先翻转到空间更大的一侧，避免出现滚动条
    const itemCount = (item.mvUrl ? 1 : 0) + 4;
    const estimatedH = panel?.offsetHeight || itemCount * 30 + 12;
    const spaceBelow = bounds.bottom - r.bottom - gap;
    const spaceAbove = r.top - bounds.top - gap;
    const placeAbove = estimatedH > spaceBelow && spaceAbove >= spaceBelow;

    let top;
    let maxHeight;
    if (placeAbove) {
      maxHeight = Math.max(40, spaceAbove);
      const h = Math.min(estimatedH, maxHeight);
      top = r.top - gap - h;
    } else {
      top = r.bottom + gap;
      maxHeight = Math.max(40, bounds.bottom - top);
      const h = Math.min(estimatedH, maxHeight);
      if (top + h > bounds.bottom) {
        top = Math.max(bounds.top + gap, bounds.bottom - h);
      }
    }

    const right = Math.max(window.innerWidth - bounds.right, window.innerWidth - r.right);

    setMenuPos({ top, right, maxHeight });
  }, [item.mvUrl]);

  useLayoutEffect(() => {
    if (!menuOpen) return undefined;
    updateMenuPos();
    // 菜单渲染后再量一次高度，末行可翻转到上方并限制在列表壳内
    const raf = requestAnimationFrame(() => updateMenuPos());
    const onResize = () => updateMenuPos();
    // 列表滚动时直接关闭，避免 portal 菜单漂出 virtual-playlist 可视区域
    const onScrollClose = () => closeMenu();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScrollClose, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScrollClose, true);
    };
  }, [menuOpen, updateMenuPos, closeMenu, item.mvUrl, isFavorite]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    // 用 click（冒泡）关闭，避免 capture pointerdown 在按钮 click 前卸掉菜单
    const onDocClick = (e) => {
      const t = e.target;
      if (triggerRef.current?.contains(t) || menuPanelRef.current?.contains(t)) return;
      closeMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, closeMenu]);

  // 滚出可视区时关掉菜单（渲染期校正，避免 effect 内同步 setState）
  if (!isVisible && menuOpen) {
    setMenuOpen(false);
  }

  const shareTrack = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeMenu();
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

  const downloadTrack = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeMenu();
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
  };

  const deleteTrack = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeMenu();
    onDelete && onDelete(item.url);
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
      <span className="index" style={{ color: 'var(--skin-highlight)' }}>
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

      <div className="actions-inline">
        {item.mvUrl ? (
          <a
            className="download-link actions-desktop-only"
            href={item.mvUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`打开MV ${song}${artist ? ' - ' + artist : ''}`}
            style={{
              color: 'var(--skin-highlight)',
              textDecoration: 'none',
              fontSize: '13px',
              padding: '0',
              border: 'none',
              verticalAlign: 'baseline',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--skin-highlight-soft)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--skin-highlight)')}
          >
            MV
          </a>
        ) : null}

        <button
          type="button"
          className="favorite-btn actions-desktop-only"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite && onToggleFavorite(item.url, !isFavorite);
          }}
          aria-label={`${isFavorite ? '取消收藏' : '收藏'} ${song}${artist ? ' - ' + artist : ''}`}
          id={`favorite-btn-${item.url}`}
          name="favorite"
          style={{
            color: 'var(--skin-highlight)',
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
            e.currentTarget.style.color = 'var(--skin-highlight-soft)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--skin-highlight)';
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={isFavorite ? `url(#${favGradId})` : 'none'}
            stroke={isFavorite ? `url(#${favGradId})` : 'currentColor'}
            strokeWidth="2"
          >
            <defs>
              <linearGradient id={favGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--skin-progress-from)" />
                <stop offset="100%" stopColor="var(--skin-progress-to)" />
              </linearGradient>
            </defs>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        <button
          type="button"
          className="download-link actions-desktop-only"
          onClick={shareTrack}
          onTouchStart={(e) => {
            e.stopPropagation();
            shareTrack(e);
          }}
          aria-label={`分享 ${song}${artist ? ' - ' + artist : ''}`}
          id={`share-btn-${item.url}`}
          name="share"
          style={{
            color: 'var(--skin-highlight)',
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
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--skin-highlight-soft)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--skin-highlight)')}
        >
          分享
        </button>

        <button
          type="button"
          className="delete-link actions-desktop-only"
          onClick={(e) => {
            e.stopPropagation();
            onDelete && onDelete(item.url);
          }}
          aria-label={`删除 ${song}${artist ? ' - ' + artist : ''}`}
          id={`delete-btn-${item.url}`}
          name="delete"
          style={{
            color: 'var(--skin-highlight)',
            background: 'transparent',
            border: 'none',
            fontSize: '13px',
            padding: '0',
            cursor: 'pointer',
            verticalAlign: 'baseline',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--skin-highlight-soft)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--skin-highlight)')}
        >
          删除
        </button>

        <button
          type="button"
          className="download-link actions-desktop-only"
          onClick={downloadTrack}
          onTouchStart={(e) => {
            e.stopPropagation();
            const url = item?.url || '';
            if (!url) return;
            // 在触摸设备上，直接打开链接
            window.open(url, '_blank');
          }}
          aria-label={`下载 ${song}${artist ? ' - ' + artist : ''}`}
          style={{
            color: 'var(--skin-highlight)',
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
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--skin-highlight-soft)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--skin-highlight)')}
        >
          下载
        </button>

        {/* 仅移动端显示的三点菜单；桌面端由 CSS 隐藏。菜单 portal 到 body，避免被虚拟列表裁切/挡点击 */}
        <div className={`actions-overflow actions-mobile-only${menuOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="actions-overflow-trigger"
            ref={triggerRef}
            aria-label={`更多操作 ${song}${artist ? ' - ' + artist : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <span className="actions-overflow-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
          {menuOpen
            ? createPortal(
                <div
                  className="actions-overflow-menu actions-overflow-menu-portal"
                  role="menu"
                  id={menuId}
                  ref={menuPanelRef}
                  style={{
                    top: menuPos.top,
                    right: menuPos.right,
                    maxHeight: menuPos.maxHeight,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.mvUrl ? (
                    <a
                      className="actions-overflow-item"
                      role="menuitem"
                      href={item.mvUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeMenu();
                      }}
                    >
                      MV
                    </a>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className="actions-overflow-item"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeMenu();
                      onToggleFavorite && onToggleFavorite(item.url, !isFavorite);
                    }}
                  >
                    {isFavorite ? '取消收藏' : '收藏'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="actions-overflow-item"
                    onClick={shareTrack}
                  >
                    分享
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="actions-overflow-item"
                    onClick={deleteTrack}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="actions-overflow-item"
                    onClick={downloadTrack}
                  >
                    下载
                  </button>
                </div>,
                document.body,
              )
            : null}
        </div>
      </div>
    </li>
  );
}
