import { LOCAL_KEYS, setLocalBgFile, setUiString } from './localState';

/** 单条背景 dataUrl 过大时不同步到 Gist/KV，避免整份 music.json 超限 */
const MAX_LOCAL_BG_SYNC_CHARS = 750000;

/**
 * 构造写入云端的 appearance（控制体积）
 * @param {{ fontFamily?: string, bgUrl?: string, localBgFile?: object | null, skinId?: string, audioAuraEnabled?: boolean, audioAuraIntensity?: number }} appearance
 */
export function slimAppearanceForRemote(appearance) {
  if (!appearance || typeof appearance !== 'object') return {};
  const out = {
    fontFamily: appearance.fontFamily ?? '',
    bgUrl: appearance.bgUrl ?? '',
  };
  if (appearance.skinId != null && appearance.skinId !== '') {
    out.skinId = String(appearance.skinId);
  }
  if (typeof appearance.audioAuraEnabled === 'boolean') {
    out.audioAuraEnabled = appearance.audioAuraEnabled;
  }
  if (
    typeof appearance.audioAuraIntensity === 'number' &&
    Number.isFinite(appearance.audioAuraIntensity)
  ) {
    out.audioAuraIntensity = Math.min(1, Math.max(0, appearance.audioAuraIntensity));
  }
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
      setUiString(LOCAL_KEYS.audioLoadMethod, String(proxy.audioLoadMethod ?? ''));
      touched = true;
    }
    // 自定义代理 URL 仅本机保存，不同步/不恢复到输入框
  }

  if (appearance && typeof appearance === 'object') {
    if ('fontFamily' in appearance) {
      setUiString(LOCAL_KEYS.fontFamily, String(appearance.fontFamily ?? ''));
      touched = true;
    }
    if ('bgUrl' in appearance) {
      setUiString(LOCAL_KEYS.bgUrl, String(appearance.bgUrl ?? ''));
      touched = true;
    }
    if ('localBgFile' in appearance) {
      const lf = appearance.localBgFile;
      setLocalBgFile(lf && typeof lf === 'object' ? lf : null);
      touched = true;
    }
    if ('skinId' in appearance) {
      setUiString(LOCAL_KEYS.skinId, String(appearance.skinId || 'sakura'));
      touched = true;
    }
    if ('audioAuraEnabled' in appearance) {
      const off =
        appearance.audioAuraEnabled === false ||
        appearance.audioAuraEnabled === 0 ||
        appearance.audioAuraEnabled === '0' ||
        appearance.audioAuraEnabled === 'false';
      setUiString(LOCAL_KEYS.audioAuraEnabled, off ? '0' : '1');
      touched = true;
    }
    if ('audioAuraIntensity' in appearance) {
      const n = Number(appearance.audioAuraIntensity);
      if (Number.isFinite(n)) {
        setUiString(LOCAL_KEYS.audioAuraIntensity, String(Math.min(1, Math.max(0, n))));
        touched = true;
      }
    }
  }

  return touched;
}
