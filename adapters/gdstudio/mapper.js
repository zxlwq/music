import {
  DEFAULT_BITRATE,
  DEFAULT_PIC_SIZE,
  DEFAULT_SOURCE,
  PROVIDER_ID,
  PROXY_PATH,
} from './config.js';

function formatArtists(artist) {
  if (Array.isArray(artist)) {
    return artist.filter(Boolean).map(String).join(' / ');
  }
  return artist ? String(artist) : '';
}

function buildProxyUrl(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  return `${PROXY_PATH}?${q.toString()}`;
}

/**
 * 将 GD Studio 搜索结果映射为本项目曲目结构：
 * { title, url, cover?, provider?, meta? }
 */
export function mapSearchItem(item, options = {}) {
  if (!item || item.id == null) return null;

  const source = item.source || options.source || DEFAULT_SOURCE;
  const id = String(item.id);
  const name = String(item.name || '').trim() || '未知曲目';
  const artists = formatArtists(item.artist);
  const title = artists ? `${name} - ${artists}` : name;
  const picId = item.pic_id != null ? String(item.pic_id) : '';
  const lyricId = item.lyric_id != null ? String(item.lyric_id) : id;
  const br = options.br || DEFAULT_BITRATE;
  const picSize = options.picSize || DEFAULT_PIC_SIZE;

  return {
    title,
    url: buildProxyUrl({
      types: 'play',
      source,
      id,
      br,
    }),
    cover: picId
      ? buildProxyUrl({
          types: 'pic',
          source,
          id: picId,
          size: picSize,
        })
      : undefined,
    provider: PROVIDER_ID,
    meta: {
      id,
      source,
      album: item.album ? String(item.album) : '',
      picId,
      lyricId,
      artists,
      name,
    },
  };
}

export function mapSearchResults(list, options = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const track = mapSearchItem(item, options);
    if (!track || !track.url) continue;
    if (seen.has(track.url)) continue;
    seen.add(track.url);
    out.push(track);
  }
  return out;
}

export function isProviderTrack(track) {
  if (!track) return false;
  if (track.provider === PROVIDER_ID) return true;
  const url = String(track.url || '');
  return url.includes(PROXY_PATH) || url.startsWith(`${PROXY_PATH}?`);
}
