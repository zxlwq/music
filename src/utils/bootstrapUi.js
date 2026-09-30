import { loadUiSettingsFromSync } from '../services/api';
import { applyThemeFromStorage } from '../hooks/theme';
import { isBrowserOffline } from './network';
import { applyRemoteUiSettingsToStorage } from './SettingsUI';

const BOOT_TIMEOUT_MS = 5000;

function hasLocalSkin() {
  try {
    return Boolean(localStorage.getItem('ui.skinId'));
  } catch {
    return false;
  }
}

/**
 * 首屏外观：有本地皮肤立即应用；无本地（清数据 / 无痕）则先等云端再上色，避免先闪默认主题。
 */
export async function bootstrapAppearance() {
  if (hasLocalSkin()) {
    applyThemeFromStorage();
    return;
  }

  if (isBrowserOffline()) {
    applyThemeFromStorage();
    return;
  }

  try {
    const remote = await Promise.race([
      loadUiSettingsFromSync(),
      new Promise((resolve) => {
        setTimeout(() => resolve(null), BOOT_TIMEOUT_MS);
      }),
    ]);
    if (remote) {
      applyRemoteUiSettingsToStorage(remote);
    }
  } catch (e) {
    console.warn('启动时加载云端外观失败:', e);
  }

  applyThemeFromStorage();
}
