import { useEffect } from 'react';
import { preloadBackgroundImage } from '../utils/image';
import { applySkin, getSkinId } from '../skins';

function getSavedBgUrl() {
  try {
    const localBgData = localStorage.getItem('ui.localBgFile');
    if (localBgData) {
      try {
        const parsed = JSON.parse(localBgData);
        if (parsed.dataUrl) return parsed.dataUrl;
      } catch {
        /* ignore */
      }
    }
    return localStorage.getItem('ui.bgUrl') || '';
  } catch {
    return '';
  }
}

/**
 * 背景只通过 CSS 变量驱动，避免把渐变烤死在 body/#root 的 inline style 上。
 *
 * 整页两侧：背景图 + 中性压暗（不跟皮肤彩色渐变）
 * 主题皮肤：只作用在中间面板 / 按钮 / 进度条等
 *
 * --user-bg-image：自定义或默认底图
 */
export function applySkinBackground(bgUrl) {
  const url = bgUrl == null ? getSavedBgUrl() : bgUrl;
  const html = document.documentElement;

  if (url) {
    // 转义 url 中的引号，避免破坏 CSS
    const safe = String(url).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    html.style.setProperty('--user-bg-image', `url('${safe}')`);
  } else {
    html.style.removeProperty('--user-bg-image');
  }

  // 清掉历史 inline 背景，交还给 stylesheet（含 var(--skin-*)）
  for (const el of [document.body, document.getElementById('root')]) {
    if (!el) continue;
    el.style.backgroundColor = '';
    el.style.backgroundImage = '';
    el.style.backgroundAttachment = '';
    el.style.backgroundRepeat = '';
    el.style.backgroundPosition = '';
    el.style.backgroundSize = '';
  }

  if (url && !String(url).startsWith('data:')) {
    preloadBackgroundImage(url).catch(() => {});
  }
}

/** @deprecated 保留导出以免旧调用报错；请优先用 CSS 变量方案 */
export function buildBodyBackgroundImage(bgUrl = '') {
  const url = bgUrl || '';
  if (url)
    return `var(--skin-page-scrim, linear-gradient(180deg, rgba(0,0,0,.3), rgba(0,0,0,.3))), url('${url}')`;
  return `var(--skin-page-scrim, linear-gradient(180deg, rgba(0,0,0,.3), rgba(0,0,0,.3))), var(--user-bg-image, url('/images/background.webp'))`;
}

export function applyThemeFromStorage() {
  try {
    applySkin(getSkinId());

    const ff = localStorage.getItem('ui.fontFamily') || '';
    const root = document.documentElement;
    if (root) {
      root.style.setProperty(
        '--font-family',
        ff ||
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial',
      );
    }
    applySkinBackground();
  } catch {}
}

export const useTheme = () => {
  useEffect(() => {
    applyThemeFromStorage();
    const onSynced = () => applyThemeFromStorage();
    const onSkin = () => applySkinBackground();
    window.addEventListener('music-ui-settings-synced', onSynced);
    window.addEventListener('music-skin-changed', onSkin);
    return () => {
      window.removeEventListener('music-ui-settings-synced', onSynced);
      window.removeEventListener('music-skin-changed', onSkin);
    };
  }, []);
};
