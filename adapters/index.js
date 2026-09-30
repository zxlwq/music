/**
 * 在线音乐适配层入口。
 *
 * 当前接入：GD Studio（adapters/gdstudio）
 * - 关闭：将下方 ENABLED 设为 false，或 gdstudio/config.js 的 ENABLED
 * - 更换/失效：只改 adapters/ 目录，业务侧仅依赖本文件的 searchOnline
 */

export { ENABLED, PROVIDER_ID, searchOnline, isProviderTrack } from './gdstudio/index.js';
