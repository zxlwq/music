const ENABLED_KEY = 'ui.audioAuraEnabled';
const INTENSITY_KEY = 'ui.audioAuraIntensity';

/**
 * @returns {{ enabled: boolean, intensity: number }}
 */
export function getAudioAuraSettings() {
  let enabled = true;
  let intensity = 1;
  try {
    const e = localStorage.getItem(ENABLED_KEY);
    if (e === '0' || e === 'false') enabled = false;
    const raw = parseFloat(localStorage.getItem(INTENSITY_KEY) ?? '1');
    if (Number.isFinite(raw)) intensity = Math.min(1, Math.max(0, raw));
  } catch {
    /* ignore */
  }
  return { enabled, intensity };
}

/**
 * @param {{ enabled?: boolean, intensity?: number }} patch
 */
export function persistAudioAuraSettings(patch = {}) {
  const cur = getAudioAuraSettings();
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : cur.enabled;
  let intensity = typeof patch.intensity === 'number' ? patch.intensity : cur.intensity;
  intensity = Math.min(1, Math.max(0, intensity));
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
    localStorage.setItem(INTENSITY_KEY, String(intensity));
  } catch {
    /* ignore */
  }
  return { enabled, intensity };
}

/** 把开关/强度写到 .container CSS，并通知分析钩子 */
export function applyAudioAuraPrefs(next) {
  const { enabled, intensity } = next && typeof next === 'object' ? next : getAudioAuraSettings();

  const host = document.querySelector('.container');
  if (host instanceof HTMLElement) {
    host.style.setProperty('--aura-intensity', Number(intensity).toFixed(3));
    host.classList.toggle('audio-aura-disabled', !enabled);
  }

  window.dispatchEvent(
    new CustomEvent('audioAuraSettingsChanged', { detail: { enabled, intensity } }),
  );
  return { enabled, intensity };
}

/** 写入 localStorage 并立即应用到页面 */
export function saveAndApplyAudioAura(patch) {
  const next = persistAudioAuraSettings(patch);
  return applyAudioAuraPrefs(next);
}
