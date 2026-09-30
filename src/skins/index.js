/**
 * 渐变主题皮肤目录入口。
 * 业务侧请只依赖本文件：listSkins / applySkin / getSkinId 等。
 */

export const DEFAULT_SKIN_ID = 'sakura';

/** @type {{ id: string, name: string }[]} */
export const SKINS = [
  { id: 'sakura', name: '樱粉' },
  { id: 'ocean', name: '海雾' },
  { id: 'sunset', name: '暮橙' },
  { id: 'forest', name: '翠野' },
  { id: 'aurora', name: '极光' },
  { id: 'glacier', name: '冰川' },
  { id: 'ember', name: '余烬' },
  { id: 'grape', name: '葡萄' },
  { id: 'honey', name: '蜜金' },
  { id: 'wine', name: '酒红' },
  { id: 'mist', name: '烟岚' },
  { id: 'citrus', name: '青柠' },
];

const SKIN_IDS = new Set(SKINS.map((s) => s.id));

export function listSkins() {
  return SKINS.slice();
}

export function resolveSkinId(id) {
  const v = String(id || '').trim();
  return SKIN_IDS.has(v) ? v : DEFAULT_SKIN_ID;
}

export function getSkinId() {
  try {
    return resolveSkinId(localStorage.getItem('ui.skinId'));
  } catch {
    return DEFAULT_SKIN_ID;
  }
}

/**
 * 将皮肤写到 <html data-skin="...">，由 skins.css 覆盖全站 CSS 变量。
 * 切换后派发 music-skin-changed，便于刷新背景层等。
 */
export function applySkin(id) {
  const skinId = resolveSkinId(id);
  try {
    document.documentElement.setAttribute('data-skin', skinId);
    window.dispatchEvent(new CustomEvent('music-skin-changed', { detail: { skinId } }));
  } catch {
    /* ignore */
  }
  return skinId;
}

export function persistSkin(id) {
  const skinId = resolveSkinId(id);
  try {
    localStorage.setItem('ui.skinId', skinId);
  } catch {
    /* ignore */
  }
  return applySkin(skinId);
}
