import { useEffect, useState } from 'react';
import { getImagePreloader } from '../utils/image';

export default function CoverArt({ currentTrack, isPlaying }) {
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!currentTrack?.cover) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 重置状态是合理的，避免显示旧的封面
      setCoverLoaded(false);
      setImageError(false);
      return;
    }

    setCoverLoaded(false);
    setImageError(false);

    const preloader = getImagePreloader();

    const cachedImage = preloader.getCachedImage(currentTrack.cover);
    if (cachedImage) {
      setCoverLoaded(true);
      return;
    }

    preloader
      .preloadImage(currentTrack.cover, {
        crossOrigin: 'anonymous',
        timeout: 3000,
        priority: 'high',
      })
      .then(() => {
        setCoverLoaded(true);
      })
      .catch((error) => {
        console.warn('Cover image preload failed:', error);
        setCoverLoaded(false);
        setImageError(true);
      });
  }, [currentTrack?.cover]);

  return (
    <div className={`art-lg ${isPlaying ? 'playing' : ''}`} aria-hidden="true">
      <div className={`disc ${isPlaying ? 'playing' : ''}`}>
        {currentTrack?.cover && !imageError ? (
          <img
            src={currentTrack.cover}
            alt="封面"
            loading="eager"
            decoding="sync"
            style={{
              opacity: coverLoaded ? 1 : 0.1,
              transition: 'opacity 0.2s ease',
              willChange: 'opacity',
            }}
            onLoad={() => setCoverLoaded(true)}
            onError={() => {
              setCoverLoaded(false);
              setImageError(true);
            }}
          />
        ) : (
          <div
            className="art-fallback"
            style={{
              width: '70%',
              height: '70%',
              borderRadius: '50%',
              background: 'linear-gradient(45deg, #ff6b6b, #4ecdc4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '12px',
              fontWeight: 'bold',
            }}
          >
            🎵
          </div>
        )}
      </div>
    </div>
  );
}
