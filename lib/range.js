/** @typedef {{ start: number, end: number, length: number, total: number }} ParsedByteRange */

/**
 * 解析单个 bytes 范围。无效或不支持的格式返回 null（调用方忽略 Range）；
 * 有效但超出文件范围时返回 unsatisfiable。
 * @param {string | null | undefined} header
 * @param {number} total
 * @returns {ParsedByteRange | { unsatisfiable: true } | null}
 */
export function parseByteRange(header, total) {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!Number.isSafeInteger(total) || total < 0) return null;
  if (total === 0) return { unsatisfiable: true };

  let start;
  let end;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (suffixLength === 0) return { unsatisfiable: true };
    start = Number.isSafeInteger(suffixLength) ? Math.max(0, total - suffixLength) : 0;
    end = total - 1;
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start >= total) return { unsatisfiable: true };
    const requestedEnd = match[2] ? Number(match[2]) : total - 1;
    end = Number.isFinite(requestedEnd) ? Math.min(total - 1, requestedEnd) : total - 1;
    if (end < start) return { unsatisfiable: true };
  }

  return { start, end, length: end - start + 1, total };
}
