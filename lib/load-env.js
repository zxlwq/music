import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @param {string} raw
 * @returns {string}
 */
function unquote(raw) {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Load `.env` from cwd into `process.env` (does not override existing vars).
 * @param {string} [cwd]
 * @returns {boolean} true if a `.env` file was found and parsed
 */
export function loadEnvFile(cwd = process.cwd()) {
  const envPath = resolve(cwd, '.env');
  if (!existsSync(envPath)) return false;

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const raw = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;

    const key = raw.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquote(raw.slice(eq + 1));
  }

  return true;
}
