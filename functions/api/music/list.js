import { filenameToDisplayTitle } from '../../../lib/title.js';

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];
const isAudio = (name) =>
  AUDIO_EXTS.some((ext) =>
    String(name || '')
      .toLowerCase()
      .endsWith(ext),
  );

function createProxyFetch(proxyUrl) {
  if (!proxyUrl) return fetch;

  return async (url, options = {}) => {
    if (url.includes('api.github.com') || url.includes('raw.githubusercontent.com')) {
      try {
        const directResponse = await fetch(url, options);
        if (directResponse.ok) {
          return directResponse;
        }
        console.log(`[list] Direct request failed (${directResponse.status}), trying proxy...`);
      } catch (error) {
        console.log(`[list] Direct request error: ${error.message}, trying proxy...`);
      }

      const targetUrl = encodeURIComponent(url);
      const proxiedUrl = `${proxyUrl}?target=${targetUrl}`;

      const proxyOptions = {
        ...options,
        headers: {
          ...options.headers,
          'X-Target-URL': url,
          'X-Proxy-Type': 'github-api',
        },
      };

      console.log(`[list] Using proxy: ${proxiedUrl}`);
      return fetch(proxiedUrl, proxyOptions);
    }

    return fetch(url, options);
  };
}

export const onRequestGet = async ({ env, request: _request }) => {
  try {
    const repoFull = env.GIT_REPO;
    const token = env.GIT_TOKEN;
    const branch = env.GIT_BRANCH || 'main';

    const proxyUrl = env.GIT_URL;
    const proxyFetch = createProxyFetch(proxyUrl);

    if (!repoFull) {
      return new Response(
        JSON.stringify({
          error: 'GIT_REPO environment variable not configured',
          details: 'Please set GIT_REPO in Cloudflare Pages environment variables',
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        },
      );
    }

    if (!token) {
      return new Response(
        JSON.stringify({
          error: 'GIT_TOKEN environment variable not configured',
          details: 'Please set GIT_TOKEN in Cloudflare Pages environment variables',
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        },
      );
    }
    const [owner, repo] = String(repoFull).split('/');

    if (!owner || !repo) {
      return new Response(
        JSON.stringify({
          error: 'Invalid GIT_REPO format',
          details: 'GIT_REPO should be in format "owner/repo"',
          provided: repoFull,
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        },
      );
    }

    const api = `https://api.github.com/repos/${owner}/${repo}/contents/public/music?ref=${encodeURIComponent(branch)}`;
    const gh = await proxyFetch(api, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)',
      },
    });

    if (!gh.ok) {
      const errorText = await gh.text();
      let errorDetails = `GitHub API error: ${gh.status}`;

      if (gh.status === 401) {
        errorDetails = 'GitHub token is invalid or expired';
      } else if (gh.status === 403) {
        errorDetails = 'GitHub token lacks repository access permissions';
      } else if (gh.status === 404) {
        errorDetails = 'Repository not found or public/music directory does not exist';
      }

      return new Response(
        JSON.stringify({
          error: errorDetails,
          status: gh.status,
          details: errorText,
          api_url: api,
        }),
        {
          status: gh.status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        },
      );
    }
    const items = await gh.json();
    const files = (Array.isArray(items) ? items : []).filter(
      (it) => it && it.type === 'file' && isAudio(it.name),
    );
    const tracks = files.map((f) => ({
      title: filenameToDisplayTitle(f.name || '') || f.name,
      url:
        f.download_url ||
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/public/music/${encodeURIComponent(f.name)}`,
    }));
    return new Response(JSON.stringify({ ok: true, tracks }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'list error' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
    },
  });
};
