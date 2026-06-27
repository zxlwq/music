import { useEffect } from 'react';
import { preloadBackgroundImage } from '../utils/image';

function applyThemeFromStorage() {
  try {
    const ff = localStorage.getItem('ui.fontFamily') || '';
    let bg = '';
    const localBgData = localStorage.getItem('ui.localBgFile');
    if (localBgData) {
      try {
        const parsed = JSON.parse(localBgData);
        if (parsed.dataUrl) {
          bg = parsed.dataUrl;
        }
      } catch {}
    }
    if (!bg) {
      bg = localStorage.getItem('ui.bgUrl') || '';
    }
    const root = document.documentElement;
    const body = document.body;
    if (root) {
      root.style.setProperty(
        '--font-family',
        ff ||
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial',
      );
    }
    if (body) {
      if (bg) {
        const base = 'linear-gradient(180deg, rgba(0, 0, 0, .3), rgba(0, 0, 0, .3))';
        body.style.backgroundImage = `${base}, url('${bg}')`;
        if (!bg.startsWith('data:')) {
          preloadBackgroundImage(bg).catch(() => {});
        }
      } else {
        body.style.backgroundImage = '';
      }
    }
  } catch {}
}

export const useTheme = () => {
  useEffect(() => {
    applyThemeFromStorage();
    const onSynced = () => applyThemeFromStorage();
    window.addEventListener('music-ui-settings-synced', onSynced);
    return () => window.removeEventListener('music-ui-settings-synced', onSynced);
  }, []);
};
