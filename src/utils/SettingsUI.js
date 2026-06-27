/** 单条背景 dataUrl 过大时不同步到 Gist/KV，避免整份 music.json 超限 */
const MAX_LOCAL_BG_SYNC_CHARS = 750000;

/**
 * 构造写入云端的 appearance（控制体积）
 * @param {{ fontFamily?: string, bgUrl?: string, localBgFile?: object | null }} appearance
 */
export function slimAppearanceForRemote(appearance) {
  if (!appearance || typeof appearance !== 'object') return {};
  const out = {
    fontFamily: appearance.fontFamily ?? '',
    bgUrl: appearance.bgUrl ?? '',
  };
  const lf = appearance.localBgFile;
  if (lf && typeof lf === 'object') {
    try {
      if (JSON.stringify(lf).length <= MAX_LOCAL_BG_SYNC_CHARS) {
        out.localBgFile = lf;
      }
    } catch {
      /* skip */
    }
  } else if (lf === null) {
    out.localBgFile = null;
  }
  return out;
}

/**
 * 将云端拉取的 uiSettings 写入 localStorage（仅处理存在的字段）
 * @returns {boolean} 是否写入了任意项
 */
export function applyRemoteUiSettingsToStorage(uiSettings) {
  if (!uiSettings || typeof uiSettings !== 'object') return false;
  let touched = false;
  const { proxy, appearance } = uiSettings;

  if (proxy && typeof proxy === 'object') {
    if ('audioLoadMethod' in proxy) {
      try {
        localStorage.setItem('ui.audioLoadMethod', String(proxy.audioLoadMethod ?? ''));
        touched = true;
      } catch {
        /* ignore */
      }
    }
    if ('customProxyUrl' in proxy) {
      try {
        localStorage.setItem('ui.customProxyUrl', String(proxy.customProxyUrl ?? ''));
        touched = true;
      } catch {
        /* ignore */
      }
    }
  }

  if (appearance && typeof appearance === 'object') {
    if ('fontFamily' in appearance) {
      try {
        localStorage.setItem('ui.fontFamily', String(appearance.fontFamily ?? ''));
        touched = true;
      } catch {
        /* ignore */
      }
    }
    if ('bgUrl' in appearance) {
      try {
        localStorage.setItem('ui.bgUrl', String(appearance.bgUrl ?? ''));
        touched = true;
      } catch {
        /* ignore */
      }
    }
    if ('localBgFile' in appearance) {
      try {
        const lf = appearance.localBgFile;
        if (lf && typeof lf === 'object') {
          localStorage.setItem('ui.localBgFile', JSON.stringify(lf));
        } else {
          localStorage.removeItem('ui.localBgFile');
        }
        touched = true;
      } catch {
        /* ignore */
      }
    }
  }

  return touched;
}
