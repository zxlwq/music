import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import VScroll from './VScroll';
import VItem from './VItem';

export default function VPlaylist({
  tracks,
  currentIndex,
  onSelect,
  onDelete,
  onToggleFavorite,
  favoriteUrls = new Set(),
  itemHeight = 45,
  containerHeight = 400,
  overscan = 5,
}) {
  const containerRef = useRef(null);
  const virtualScrollRef = useRef(null);
  const [showLocate, setShowLocate] = useState(false);
  const idleTimerRef = useRef(null);
  const locateBtnRef = useRef(null);
  const hoveringRef = useRef(false);

  const scheduleHide = useCallback((delay = 700) => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const tick = () => {
      if (hoveringRef.current) {
        idleTimerRef.current = setTimeout(tick, delay);
      } else {
        setShowLocate(false);
      }
    };
    idleTimerRef.current = setTimeout(tick, delay);
  }, []);

  const locateNowPlaying = useCallback(
    (e) => {
      if (e) e.stopPropagation();
      if (virtualScrollRef.current && currentIndex >= 0) {
        virtualScrollRef.current.scrollToIndex(currentIndex);
      }
    },
    [currentIndex],
  );

  const handleScroll = useCallback(
    (_scrollTop) => {
      setShowLocate(true);
      scheduleHide(900);
    },
    [scheduleHide],
  );

  const updateBtnTop = useCallback(() => {
    const btn = locateBtnRef.current;
    const container = containerRef.current;
    if (!btn || !container) return;

    const centerTop = container.scrollTop + container.clientHeight / 2 - btn.offsetHeight / 2;
    btn.style.top = `${Math.max(0, centerTop)}px`;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      updateBtnTop();
    };

    const onResize = () => updateBtnTop();

    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    updateBtnTop();

    return () => {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [updateBtnTop]);

  useEffect(() => {
    if (currentIndex >= 0 && virtualScrollRef.current) {
      setTimeout(() => {
        virtualScrollRef.current.scrollToIndex(currentIndex);
      }, 100);
    }
  }, [currentIndex]);

  const tracksWithKeys = useMemo(() => {
    return tracks.map((track, index) => ({
      ...track,
      key: track.url || `track-${index}`,
      id: track.url || `track-${index}`,
    }));
  }, [tracks]);

  return (
    <div className="virtual-playlist" ref={containerRef}>
      <VScroll
        ref={virtualScrollRef}
        items={tracksWithKeys}
        itemHeight={itemHeight}
        containerHeight={containerHeight}
        overscan={overscan}
        onScroll={handleScroll}
        className="virtual-scroll-container"
        style={{
          height: '100%',
          width: '100%',
        }}
      >
        {({ item, index, isVisible }) => (
          <VItem
            item={item}
            index={index}
            isVisible={isVisible}
            isActive={index === currentIndex}
            onSelect={onSelect}
            onDelete={onDelete}
            onToggleFavorite={onToggleFavorite}
            isFavorite={favoriteUrls.has(item.url)}
          />
        )}
      </VScroll>

      <button
        type="button"
        className={`locate-fab ${showLocate ? 'visible' : ''}`}
        aria-label="定位到正在播放"
        onClick={locateNowPlaying}
        ref={locateBtnRef}
        id="vplaylist-locate-fab-btn"
        name="locate-fab"
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
