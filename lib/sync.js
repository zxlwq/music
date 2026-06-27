/**
 * 用户数据同步：单用户固定键 music:doc
 * - 读：同时读取已配置的 KV、Upstash Redis、GitHub Gist，按整份文档的 `meta.updatedAt` 取最新一份作为合并基线
 * - 写：将新文档尽力并行写入上述三者中「已配置且可写」的每一项，实现三端互相同步（某端失败不阻塞其它端，但至少一端成功才返回 200）
 */

/**
 * @typedef {object} KvLike Cloudflare KV 或与之一致的接口
 * @property {(key: string) => Promise<unknown>} get
 * @property {(key: string, value: string) => Promise<void>} put
 */

/**
 * @typedef {object} RedisLike Upstash Redis 客户端（最小读写面）
 * @property {(key: string) => Promise<unknown>} get
 * @property {(key: string, value: string) => Promise<unknown>} set
 */

/**
 * @typedef {object} MusicDocNormalized normalizeMusicDoc 之后的文档
 * @property {unknown[]} favorites
 * @property {unknown} [audioCache]
 * @property {{ proxy?: object, appearance?: object } | null} [uiSettings]
 * @property {{ updatedAt: number }} meta
 */

/**
 * @typedef {object} SyncEnv Worker / Node 传入的环境对象
 * @property {KvLike} [KV]
 * @property {string} [GIT_TOKEN]
 * @property {string} [GIT_URL]
 * @property {string} [git_url]
 * @property {string} [UPSTASH_REDIS_REST_URL]
 * @property {string} [UPSTASH_REDIS_REST_TOKEN]
 */

/**
 * @typedef {'save' | 'load' | 'loadAll' | 'saveAudioCache' | 'loadAudioCache' | 'saveUiSettings' | 'loadUiSettings'} SyncAction
 */

/**
 * @typedef {object} SyncRequestBody
 * @property {SyncAction} [action]
 * @property {unknown[]} [favorites]
 * @property {object} [audioCache]
 * @property {object} [uiSettings]
 */

/**
 * @typedef {object} SyncOptions
 * @property {string} [userAgent]
 * @property {string} [builtinProxyUrl]
 */

/**
 * @typedef {{ gistId: string, sha: string | null, doc: MusicDocNormalized }} GistReadPart
 */

/**
 * @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} ProxyFetchFn
 */

/**
 * @typedef {object} GithubGistListItem
 * @property {string} id
 * @property {Record<string, { sha?: string, content?: string }>} [files]
 */

/**
 * @typedef {object} GithubGistGetBody
 * @property {Record<string, { sha?: string, content?: string }>} [files]
 */

/**
 * @typedef {object} WriteAllStoresArgs
 * @property {KvLike | null} kv
 * @property {RedisLike | null} redis
 * @property {GistReadPart | null} gistPart
 * @property {string} token
 * @property {ProxyFetchFn} proxyFetch
 * @property {string} userAgent
 * @property {MusicDocNormalized} nextDoc
 */

/**
 * @param {Headers | Record<string, string> | string[][] | undefined | null} headers
 * @returns {Record<string, string>}
 */
function headersToRecord(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

export const FIXED_USER_DOC_KEY = 'music:doc';
const GIST_FILENAME = 'music.json';
const GIST_DESCRIPTION = 'Music';

/**
 * KV / Redis / Gist 正文共用：`JSON.stringify(..., null, 2)` 多行缩进，便于人类阅读；字段插入顺序仍由构建对象决定，三端同一函数以保证一致。
 * @param {unknown} doc 已规整为可序列化的文档对象
 * @returns {string}
 */
function stringifyUserDocJson(doc) {
  return JSON.stringify(doc, null, 2);
}

/**
 * Gist `music.json` 与 KV / Redis 使用同一序列化（见 `stringifyUserDocJson`）。
 * @param {{ favorites?: unknown[], audioCache?: unknown, uiSettings?: unknown, meta?: { updatedAt?: number } }} data
 */
export function formatGistJson(data) {
  const doc = {
    favorites: Array.isArray(data.favorites) ? data.favorites : [],
    audioCache: data.audioCache ?? null,
    uiSettings: data.uiSettings ?? null,
    meta: data.meta ?? { updatedAt: Date.now() },
  };
  return stringifyUserDocJson(doc);
}

/**
 * @param {Record<string, unknown> | null | undefined} raw
 */
function normalizeUiSettingsBlob(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  const proxy = raw.proxy && typeof raw.proxy === 'object' ? { ...raw.proxy } : {};
  const appearance =
    raw.appearance && typeof raw.appearance === 'object' ? { ...raw.appearance } : {};
  if (Object.keys(proxy).length === 0 && Object.keys(appearance).length === 0) return null;
  return { proxy, appearance };
}

/**
 * @param {string | undefined | null} proxyUrl
 * @param {string | undefined | null} builtinProxyUrl
 * @returns {ProxyFetchFn}
 */
export function createProxyFetch(proxyUrl, builtinProxyUrl) {
  if (!proxyUrl && !builtinProxyUrl) return fetch;

  return async (/** @type {RequestInfo | URL} */ url, /** @type {RequestInit} */ options = {}) => {
    if (
      typeof url === 'string' &&
      (url.includes('api.github.com') || url.includes('raw.githubusercontent.com'))
    ) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[gist] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`[gist] Direct request error: ${msg}, trying proxy...`);
      }

      if (builtinProxyUrl) {
        try {
          const targetUrl = encodeURIComponent(url);
          const builtinProxiedUrl = `${builtinProxyUrl}?url=${targetUrl}`;

          const builtinOptions = {
            ...options,
            headers: {
              ...headersToRecord(options.headers),
              'X-Target-URL': url,
              'X-Proxy-Type': 'github-gist',
            },
          };

          console.log(`[gist] Using builtin proxy: ${builtinProxiedUrl}`);
          const builtinResponse = await fetch(builtinProxiedUrl, builtinOptions);
          if (builtinResponse.ok) {
            return builtinResponse;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.log(`[gist] Builtin proxy failed: ${msg}`);
        }
      }

      if (proxyUrl) {
        const targetUrl = encodeURIComponent(url);
        const proxiedUrl = `${proxyUrl}?target=${targetUrl}`;

        const proxyOptions = {
          ...options,
          headers: {
            ...headersToRecord(options.headers),
            'X-Target-URL': url,
            'X-Proxy-Type': 'github-gist',
          },
        };

        console.log(`[gist] Using custom proxy: ${proxiedUrl}`);
        return fetch(proxiedUrl, proxyOptions);
      }
    }

    return fetch(url, options);
  };
}

/**
 * @param {unknown} parsed
 * @returns {MusicDocNormalized}
 */
export function normalizeMusicDoc(parsed) {
  if (Array.isArray(parsed)) {
    return {
      favorites: parsed,
      audioCache: null,
      uiSettings: null,
      meta: { updatedAt: 0 },
    };
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = /** @type {Record<string, unknown>} */ (parsed);
    const metaRaw = o.meta && typeof o.meta === 'object' && !Array.isArray(o.meta) ? o.meta : null;
    const meta = /** @type {Record<string, unknown> | null} */ (metaRaw);
    const updatedAt = meta && typeof meta.updatedAt === 'number' ? meta.updatedAt : 0;
    return {
      favorites: Array.isArray(o.favorites) ? o.favorites : [],
      audioCache: o.audioCache ?? null,
      uiSettings: normalizeUiSettingsBlob(
        o.uiSettings && typeof o.uiSettings === 'object'
          ? /** @type {Record<string, unknown>} */ (o.uiSettings)
          : null,
      ),
      meta: { updatedAt },
    };
  }
  return {
    favorites: [],
    audioCache: null,
    uiSettings: null,
    meta: { updatedAt: 0 },
  };
}

/**
 * @param {MusicDocNormalized | null | undefined} docA
 * @param {MusicDocNormalized | null | undefined} docB
 * @returns {MusicDocNormalized | null}
 */
function pickNewer(docA, docB) {
  if (!docA && !docB) return null;
  if (!docA) return docB ?? null;
  if (!docB) return docA;
  const ta = docA.meta?.updatedAt ?? 0;
  const tb = docB.meta?.updatedAt ?? 0;
  return ta >= tb ? docA : docB;
}

/**
 * 在多个非空文档中按 `meta.updatedAt` 取最新整份文档
 * @param {(MusicDocNormalized | null | undefined)[]} docs
 * @returns {MusicDocNormalized | null}
 */
function pickNewest(docs) {
  /** @type {MusicDocNormalized | null} */
  let best = null;
  for (const d of docs) {
    best = pickNewer(best, d);
  }
  return best;
}

/** @param {SyncEnv | null | undefined} env */
function hasKvBinding(env) {
  return env?.KV && typeof env.KV.get === 'function' && typeof env.KV.put === 'function';
}

/**
 * @param {SyncEnv} env
 * @returns {Promise<RedisLike | null>}
 */
async function getRedisClient(env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[sync] Upstash Redis 未安装或初始化失败:', msg);
    return null;
  }
}

/**
 * @param {RedisLike | null} redis
 * @returns {Promise<MusicDocNormalized | null>}
 */
async function readRedisDoc(redis) {
  if (!redis) return null;
  try {
    const raw = await redis.get(FIXED_USER_DOC_KEY);
    if (raw == null || raw === '') return null;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeMusicDoc(obj);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[sync] 读取 Redis 失败:', msg);
    return null;
  }
}

/**
 * @param {RedisLike | null} redis
 * @param {MusicDocNormalized} doc
 */
async function writeRedisDoc(redis, doc) {
  if (!redis) return false;
  try {
    await redis.set(FIXED_USER_DOC_KEY, stringifyUserDocJson(doc));
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[sync] 写入 Redis 失败:', msg);
    return false;
  }
}

/**
 * @param {string} token
 * @param {ProxyFetchFn} proxyFetch
 * @param {string} userAgent
 * @returns {Promise<string>}
 */
async function findOrCreateGist(token, proxyFetch, userAgent) {
  const listRes = await proxyFetch('https://api.github.com/gists', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': userAgent,
    },
  });

  if (listRes.ok) {
    const gists = await listRes.json();
    const found = Array.isArray(gists)
      ? gists.find(
          /** @param {GithubGistListItem} g */
          (g) => !!(g.files && g.files[GIST_FILENAME]),
        )
      : null;
    if (found) return found.id;
  }

  const defaultContent = {
    favorites: [],
    audioCache: {
      enabled: true,
      config: {
        maxCacheSize: 50,
        preloadCount: 3,
        preloadDelay: 1000,
      },
    },
    uiSettings: null,
    meta: { updatedAt: Date.now() },
  };

  const createRes = await proxyFetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: formatGistJson(defaultContent),
        },
      },
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`创建 Gist 失败: ${createRes.status} ${errorText}`);
  }

  /** @type {{ id: string }} */
  const newGist = await createRes.json();
  return newGist.id;
}

/**
 * @param {string} token
 * @param {ProxyFetchFn} proxyFetch
 * @param {string} userAgent
 * @returns {Promise<GistReadPart | null>}
 */
async function tryReadGistDocument(token, proxyFetch, userAgent) {
  try {
    return await readGistDocument(token, proxyFetch, userAgent);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[sync] Gist 读取失败，将尽量使用 KV / Redis 或空状态:', msg);
    return null;
  }
}

/**
 * @param {string} token
 * @param {ProxyFetchFn} proxyFetch
 * @param {string} userAgent
 * @returns {Promise<GistReadPart>}
 */
async function readGistDocument(token, proxyFetch, userAgent) {
  const gistId = await findOrCreateGist(token, proxyFetch, userAgent);

  const getRes = await proxyFetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': userAgent,
    },
  });

  if (!getRes.ok) {
    const errorText = await getRes.text();
    throw new Error(`获取 Gist 失败: ${errorText}`);
  }

  /** @type {GithubGistGetBody} */
  const gist = await getRes.json();
  const file = gist.files?.[GIST_FILENAME];
  const sha = file?.sha ?? null;

  let doc = normalizeMusicDoc(null);
  if (file && file.content) {
    try {
      const parsed = JSON.parse(file.content);
      doc = normalizeMusicDoc(parsed);
    } catch (e) {
      console.error('[sync] 解析 Gist 内容失败:', e);
    }
  }

  return { gistId, sha, doc };
}

/**
 * @param {string} token
 * @param {ProxyFetchFn} proxyFetch
 * @param {string} userAgent
 * @param {string} gistId
 * @param {string | null} sha
 * @param {{ favorites?: unknown[], audioCache?: unknown, uiSettings?: unknown, meta?: { updatedAt?: number } }} data
 */
async function patchGist(token, proxyFetch, userAgent, gistId, sha, data) {
  const updateRes = await proxyFetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: formatGistJson(data),
          sha: sha,
        },
      },
    }),
  });

  if (!updateRes.ok) {
    const errorText = await updateRes.text();
    throw new Error(`更新 Gist 失败: ${errorText}`);
  }
}

/**
 * @param {KvLike | null} kv
 * @returns {Promise<MusicDocNormalized | null>}
 */
async function readKvDoc(kv) {
  if (!kv) return null;
  try {
    const raw = await kv.get(FIXED_USER_DOC_KEY);
    if (raw == null || raw === '') return null;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeMusicDoc(obj);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[sync] 读取 KV 失败:', msg);
    return null;
  }
}

/**
 * @param {KvLike | null} kv
 * @param {MusicDocNormalized} doc
 */
async function writeKvDoc(kv, doc) {
  if (!kv) return false;
  try {
    await kv.put(FIXED_USER_DOC_KEY, stringifyUserDocJson(doc));
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[sync] 写入 KV 失败:', msg);
    return false;
  }
}

/**
 * 将同一文档写入已配置的 KV / Redis / Gist（并行尽力）。
 * @param {WriteAllStoresArgs} stores
 * @returns {Promise<{ okKv: boolean, okRedis: boolean, okGist: boolean, anyConfigured: boolean, anySuccess: boolean }>}
 */
async function writeAllConfiguredStores(stores) {
  const { kv, redis, gistPart, token, proxyFetch, userAgent, nextDoc } = stores;
  /** 用户侧是否配置了任一后端（含仅 GIT_TOKEN 意图走 Gist） */
  const anyConfigured = !!(kv || redis || token);
  /** @type {Promise<{ key: string, ok: boolean }>[]} */
  const tasks = [];

  if (kv) {
    tasks.push(writeKvDoc(kv, nextDoc).then((ok) => ({ key: 'kv', ok })));
  }
  if (redis) {
    tasks.push(writeRedisDoc(redis, nextDoc).then((ok) => ({ key: 'redis', ok })));
  }
  if (token && gistPart) {
    tasks.push(
      patchGist(token, proxyFetch, userAgent, gistPart.gistId, gistPart.sha, nextDoc)
        .then(() => ({ key: 'gist', ok: true }))
        .catch((ge) => {
          const msg = ge instanceof Error ? ge.message : String(ge);
          console.warn('[sync] Gist 写入失败:', msg);
          return { key: 'gist', ok: false };
        }),
    );
  }

  const ok = { kv: true, redis: true, gist: true };
  if (!tasks.length) {
    return {
      okKv: false,
      okRedis: false,
      okGist: false,
      anyConfigured,
      anySuccess: false,
    };
  }

  const settled = await Promise.all(tasks);
  for (const row of settled) {
    if (row.key === 'kv') ok.kv = row.ok;
    if (row.key === 'redis') ok.redis = row.ok;
    if (row.key === 'gist') ok.gist = row.ok;
  }

  const anySuccess = settled.some((r) => r.ok);
  return {
    okKv: kv ? ok.kv : false,
    okRedis: redis ? ok.redis : false,
    okGist: token && gistPart ? ok.gist : false,
    anyConfigured,
    anySuccess,
  };
}

/**
 * @param {SyncRequestBody} body
 * @param {SyncEnv} env
 * @param {SyncOptions} [options]
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function runUserDataSync(body, env, options = /** @type {SyncOptions} */ ({})) {
  const userAgent = options.userAgent || 'web-music-player/0.1';
  const builtinProxyUrl = options.builtinProxyUrl;
  const proxyUrl = env.GIT_URL || env.git_url;
  const proxyFetch = createProxyFetch(proxyUrl, builtinProxyUrl);

  const { action, favorites, audioCache, uiSettings: uiSettingsPayload } = body;

  if (
    !action ||
    (action !== 'save' &&
      action !== 'load' &&
      action !== 'loadAll' &&
      action !== 'saveAudioCache' &&
      action !== 'loadAudioCache' &&
      action !== 'saveUiSettings' &&
      action !== 'loadUiSettings')
  ) {
    return {
      status: 400,
      body: {
        error:
          '无效的操作，必须是 save / load / loadAll / saveAudioCache / loadAudioCache / saveUiSettings / loadUiSettings',
      },
    };
  }

  const kv = hasKvBinding(env) && env.KV != null ? env.KV : null;
  const redis = await getRedisClient(env);
  const token = env.GIT_TOKEN || '';

  if (!kv && !redis && !token) {
    return {
      status: 200,
      body: {
        ok: true,
        favorites: [],
        audioCache: null,
        uiSettings: null,
        gistId: null,
        configured: false,
      },
    };
  }

  try {
    let gistPart = token ? await tryReadGistDocument(token, proxyFetch, userAgent) : null;
    const [kvDoc, redisDoc] = await Promise.all([readKvDoc(kv), readRedisDoc(redis)]);
    const gistDoc = gistPart?.doc ?? null;
    const merged = pickNewest([kvDoc, redisDoc, gistDoc]) ?? normalizeMusicDoc(null);

    if (action === 'load') {
      return {
        status: 200,
        body: {
          ok: true,
          favorites: merged.favorites || [],
          gistId: gistPart?.gistId ?? null,
        },
      };
    }

    if (action === 'loadAll') {
      return {
        status: 200,
        body: {
          ok: true,
          favorites: merged.favorites || [],
          audioCache: merged.audioCache,
          uiSettings:
            merged.uiSettings && typeof merged.uiSettings === 'object' ? merged.uiSettings : null,
          gistId: gistPart?.gistId ?? null,
        },
      };
    }

    if (action === 'loadAudioCache') {
      return {
        status: 200,
        body: {
          ok: true,
          audioCache: merged.audioCache,
          gistId: gistPart?.gistId ?? null,
        },
      };
    }

    if (action === 'loadUiSettings') {
      const raw = merged.uiSettings;
      return {
        status: 200,
        body: {
          ok: true,
          uiSettings: raw && typeof raw === 'object' ? raw : null,
          gistId: gistPart?.gistId ?? null,
        },
      };
    }

    const now = Date.now();
    /** @type {MusicDocNormalized | undefined} */
    let nextDoc;

    if (action === 'save') {
      if (!Array.isArray(favorites)) {
        return { status: 400, body: { error: '无效的收藏列表，必须是一个数组' } };
      }
      nextDoc = {
        favorites,
        audioCache: merged.audioCache,
        uiSettings: merged.uiSettings ?? null,
        meta: { updatedAt: now },
      };
    } else if (action === 'saveAudioCache') {
      if (!audioCache || typeof audioCache !== 'object') {
        return { status: 400, body: { error: '无效的音频缓存配置，必须是一个对象' } };
      }
      nextDoc = {
        favorites: merged.favorites || [],
        audioCache,
        uiSettings: merged.uiSettings ?? null,
        meta: { updatedAt: now },
      };
    } else if (action === 'saveUiSettings') {
      const incoming = uiSettingsPayload;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return { status: 400, body: { error: '无效的 uiSettings，必须是一个对象' } };
      }
      const prevUiRaw =
        merged.uiSettings &&
        typeof merged.uiSettings === 'object' &&
        !Array.isArray(merged.uiSettings)
          ? merged.uiSettings
          : {};
      const prevUi = /** @type {Record<string, unknown>} */ (prevUiRaw);
      const inc = /** @type {Record<string, unknown>} */ (incoming);
      const prevProxy =
        prevUi.proxy && typeof prevUi.proxy === 'object' && !Array.isArray(prevUi.proxy)
          ? { .../** @type {Record<string, unknown>} */ (prevUi.proxy) }
          : {};
      const prevAppearance =
        prevUi.appearance &&
        typeof prevUi.appearance === 'object' &&
        !Array.isArray(prevUi.appearance)
          ? { .../** @type {Record<string, unknown>} */ (prevUi.appearance) }
          : {};
      const incProxy =
        inc.proxy && typeof inc.proxy === 'object' && !Array.isArray(inc.proxy)
          ? { .../** @type {Record<string, unknown>} */ (inc.proxy) }
          : {};
      const incAppearance =
        inc.appearance && typeof inc.appearance === 'object' && !Array.isArray(inc.appearance)
          ? { .../** @type {Record<string, unknown>} */ (inc.appearance) }
          : {};
      nextDoc = {
        favorites: merged.favorites || [],
        audioCache: merged.audioCache,
        uiSettings: {
          proxy: { ...prevProxy, ...incProxy },
          appearance: { ...prevAppearance, ...incAppearance },
        },
        meta: { updatedAt: now },
      };
    } else {
      return {
        status: 400,
        body: { error: `不支持的写操作: ${String(action)}` },
      };
    }

    if (token && !gistPart) {
      try {
        gistPart = await readGistDocument(token, proxyFetch, userAgent);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[sync] 保存前再次读取 Gist 失败，跳过 Gist 写入:', msg);
      }
    }

    if (!nextDoc) {
      return { status: 500, body: { error: '内部错误：未生成待保存文档' } };
    }

    const { anyConfigured, anySuccess, okKv, okRedis, okGist } = await writeAllConfiguredStores({
      kv,
      redis,
      gistPart,
      token,
      proxyFetch,
      userAgent,
      nextDoc,
    });

    if (!anyConfigured) {
      return {
        status: 500,
        body: { error: '保存失败：未配置任何可写存储后端' },
      };
    }
    if (!anySuccess) {
      let errMsg = '保存失败：KV / Redis / Gist 均未写入成功';
      if (token && !gistPart && !kv && !redis) {
        errMsg = '无法读取或创建 Gist，请检查 GIT_TOKEN 与网络';
      } else if (token && !gistPart) {
        errMsg = '保存失败：Gist 元数据不可用，且其它后端未写入成功';
      }
      return { status: 500, body: { error: errMsg } };
    }
    if (kv && !okKv) console.warn('[sync] KV 写入失败，其它后端可能已成功');
    if (redis && !okRedis) console.warn('[sync] Redis 写入失败，其它后端可能已成功');
    if (token && gistPart && !okGist) console.warn('[sync] Gist 写入失败，其它后端可能已成功');

    return { status: 200, body: { ok: true, gistId: gistPart?.gistId ?? null } };
  } catch (e) {
    console.error('[sync]', e);
    const msg = e instanceof Error ? e.message : '用户数据同步失败';
    return { status: 500, body: { error: msg || '用户数据同步失败' } };
  }
}
