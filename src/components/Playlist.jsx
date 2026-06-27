import { useRef, useCallback, useEffect, useState } from 'react';

function parseTrackTitle(title) {
  if (!title) return { song: '', artist: '' };
  const match = title.match(/^(.+?)(?:\s{2,}|\s-\s)(.+)$/);
  if (match) {
    const song = match[1].trim();
    const artist = match[2].trim();
    return { song, artist };
  }
  return { song: title, artist: '' };
}

export default function Playlist({ tracks, currentIndex, onSelect, onDelete }) {
  const containerRef = useRef(null);
  const [showLocate, setShowLocate] = useState(false);
  const idleTimerRef = useRef(null);
  const locateBtnRef = useRef(null);
  const hoveringRef = useRef(false);
  const scheduleHideRef = useRef(null);

  const scheduleHide = useCallback((delay = 700) => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (hoveringRef.current) {
        scheduleHideRef.current?.(delay);
      } else {
        setShowLocate(false);
      }
    }, delay);
  }, []);

  useEffect(() => {
    scheduleHideRef.current = scheduleHide;
  }, [scheduleHide]);

  const locateNowPlaying = useCallback((e) => {
    if (e?.stopPropagation) e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector('ul.playlist li.active');
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      const top = target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2;
      container.scrollTop = Math.max(0, top);
    }
  }, []);

  const shareTrack = useCallback(async (track, song, artist, e) => {
    if (e?.stopPropagation) e.stopPropagation();
    const shareText = artist ? `${song} - ${artist}` : song;
    const url = track?.url || '';
    const shareData = { title: shareText, text: shareText, url };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else if (navigator.clipboard && url) {
        await navigator.clipboard.writeText(url);
        console.log('已复制分享链接:', url);
      }
    } catch (err) {
      console.warn('分享失败:', err);
      if (navigator.clipboard && url) {
        try {
          await navigator.clipboard.writeText(url);
        } catch {}
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateBtnTop = () => {
      const btn = locateBtnRef.current;
      if (!btn) return;
      const centerTop = container.scrollTop + container.clientHeight / 2 - btn.offsetHeight / 2;
      btn.style.top = `${Math.max(0, centerTop)}px`;
    };
    const onScroll = () => {
      setShowLocate(true);
      scheduleHide(900);
      updateBtnTop();
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    updateBtnTop();
    const onResize = () => updateBtnTop();
    window.addEventListener('resize', onResize);
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [scheduleHide]);

  return (
    <div className="playlist-container" ref={containerRef}>
      <ul className="playlist" role="listbox" aria-label="播放列表">
        {tracks.map((t, i) => {
          const { song, artist } = parseTrackTitle(t.title);
          return (
            <li
              key={t.url}
              className={i === currentIndex ? 'active' : ''}
              onClick={() => onSelect(i)}
              role="option"
              aria-selected={i === currentIndex}
            >
              <span className="index">{i + 1}</span>
              <span className="name">{artist ? `${song} - ${artist}` : song}</span>
              <div className="actions-inline">
                {t.mvUrl ? (
                  <a
                    className="download-link"
                    href={t.mvUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`打开MV ${song}${artist ? ' - ' + artist : ''}`}
                  >
                    MV
                  </a>
                ) : null}
                <button
                  type="button"
                  className="download-link"
                  onClick={(e) => shareTrack(t, song, artist, e)}
                  aria-label={`分享 ${song}${artist ? ' - ' + artist : ''}`}
                  id={`share-song-btn-${t.url}`}
                  name="share-song"
                >
                  分享
                </button>
                <button
                  type="button"
                  className="delete-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete && onDelete(t.url);
                  }}
                  aria-label={`删除 ${song}${artist ? ' - ' + artist : ''}`}
                  id={`delete-song-btn-${t.url}`}
                  name="delete-song"
                >
                  删除
                </button>
                <a
                  className="download-link"
                  href={t.url}
                  download
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`下载 ${song}${artist ? ' - ' + artist : ''}`}
                >
                  下载
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={`locate-fab ${showLocate ? 'visible' : ''}`}
        aria-label="定位到正在播放"
        id="locate-fab-btn"
        name="locate-fab"
        onClick={locateNowPlaying}
        ref={locateBtnRef}
        onMouseEnter={() => {
          hoveringRef.current = true;
          setShowLocate(true);
        }}
        onMouseLeave={() => {
          hoveringRef.current = false;
          scheduleHide(700);
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <line x1="12" y1="1" x2="12" y2="5" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" />
          <line x1="1" y1="12" x2="5" y2="12" stroke="currentColor" strokeWidth="2" />
          <line x1="19" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
    </div>
  );
}
