/** GD Studio 在线音乐 API 配置。失效时改 ENABLED 或换 BASE_URL 即可。 */

export const PROVIDER_ID = 'gdstudio';

/** 设为 false 可一键关闭在线搜索/播放，不影响本地歌单 */
export const ENABLED = true;

export const BASE_URL = 'https://music-api.gdstudio.xyz/api.php';

/**
 * 当前实测可用音乐源（仅保留联通的）。
 * 上游文档另有 tencent/kuwo/tidal 等，暂不开放则不列入。
 */
export const AVAILABLE_SOURCES = ['netease', 'joox', 'bilibili'];

/** 未指定 source 时的默认源（单次请求兜底） */
export const DEFAULT_SOURCE = 'netease';

/**
 * 在线搜索实际使用的源（可多选，须为 AVAILABLE_SOURCES 子集）。
 * - 填多个会并行搜索后合并去重；某一源失败不影响其它源结果
 * - 只想用一个时写成 ['netease'] 即可
 */
export const SEARCH_SOURCES = ['netease', 'joox', 'bilibili'];

/** 默认音质：128 / 192 / 320 / 740 / 999 */
export const DEFAULT_BITRATE = 320;

/** 每页条数（传给上游 count；部分源可能不完全遵守） */
export const DEFAULT_SEARCH_COUNT = 30;

/**
 * 每个源拉取的页数（1 = 只第一页）。
 * 总上限约：SEARCH_SOURCES.length × DEFAULT_SEARCH_COUNT × DEFAULT_SEARCH_PAGES
 * 例如 3 源 × 30 × 2 = 约 180 条（去重后更少）
 */
export const DEFAULT_SEARCH_PAGES = 2;

export const DEFAULT_PIC_SIZE = 300;

/** 本站代理路径（浏览器只访问本地，避免 CORS） */
export const PROXY_PATH = '/api/gdstudio';
