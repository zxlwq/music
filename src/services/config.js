import { isBrowserOffline } from '../utils/network';

export const DEFAULT_APP_CONFIG = {
  customProxyUrl: '',
  hasCustomProxy: false,
};

export async function fetchAppConfig() {
  if (isBrowserOffline()) {
    return DEFAULT_APP_CONFIG;
  }

  try {
    const response = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getConfig' }),
    });
    if (response.ok) {
      return await response.json();
    }
    return DEFAULT_APP_CONFIG;
  } catch (error) {
    if (isBrowserOffline()) {
      return DEFAULT_APP_CONFIG;
    }
    console.warn('加载应用配置失败:', error);
    return DEFAULT_APP_CONFIG;
  }
}
