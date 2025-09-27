// Cloudflare Pages Function: Delete a file from GitHub repo
// Env vars to configure in Cloudflare Pages -> Settings -> Environment Variables:
//   GIT_REPO: owner/repo
//   GIT_TOKEN: classic or fine-grained token with contents delete permission
//   GIT_BRANCH: branch name (default: main)

async function extractPathFromRawUrl(url) {
  try {
    // Support raw.githubusercontent.com URL
    // e.g. https://raw.githubusercontent.com/owner/repo/branch/public/music/%E7%BA%A2%E5%B0%98%E6%81%8B%E6%AD%8C-%E9%AB%98%E5%AE%89.mp3
    const u = new URL(url)
    if (u.hostname === 'raw.githubusercontent.com') {
      const parts = u.pathname.split('/').filter(Boolean)
      // [owner, repo, branch, ...path]
      if (parts.length >= 4) {
        const rest = parts.slice(3).join('/')
        return decodeURIComponent(rest)
      }
    }
  } catch {}
  return null
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const { filePath, rawUrl } = await request.json()
    const repoFull = env.GIT_REPO
    const token = env.GIT_TOKEN
    const branch = env.GIT_BRANCH || 'main'

    if (!repoFull || !token) {
      return new Response(JSON.stringify({ error: 'Server not configured: GIT_REPO/GIT_TOKEN missing' }), { status: 500, headers: { 'content-type': 'application/json' } })
    }

    let pathInRepo = String(filePath || '').replace(/^\/+/, '')
    if (!pathInRepo && rawUrl) {
      const extracted = await extractPathFromRawUrl(rawUrl)
      if (extracted) pathInRepo = extracted
    }
    if (!pathInRepo) {
      return new Response(JSON.stringify({ error: 'Missing filePath or rawUrl' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }

    // Ensure we only delete within public/music
    if (!/^public\/music\//.test(pathInRepo)) {
      return new Response(JSON.stringify({ error: 'Refusing to delete outside public/music' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }

    const [owner, repo] = String(repoFull).split('/')
    const metaApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}?ref=${encodeURIComponent(branch)}`
    // 1) Get file SHA
    const metaRes = await fetch(metaApi, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)'
      }
    })
    if (metaRes.status === 404) {
      return new Response(JSON.stringify({ ok: true, skipped: true, message: 'File not found' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (!metaRes.ok) {
      const t = await metaRes.text()
      return new Response(JSON.stringify({ error: `Meta fetch failed: ${metaRes.status} ${t}` }), { status: metaRes.status, headers: { 'content-type': 'application/json' } })
    }
    const meta = await metaRes.json()
    const sha = meta.sha
    if (!sha) {
      return new Response(JSON.stringify({ error: 'File SHA not found' }), { status: 500, headers: { 'content-type': 'application/json' } })
    }

    // 2) Delete file
    const delApi = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathInRepo)}`
    const body = {
      message: `Delete music: ${pathInRepo}`,
      sha,
      branch
    }
    const delRes = await fetch(delApi, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'web-music-player/0.1 (Cloudflare Pages Function)'
      },
      body: JSON.stringify(body)
    })
    if (!delRes.ok) {
      const t = await delRes.text()
      return new Response(JSON.stringify({ error: `Delete failed: ${delRes.status} ${t}` }), { status: delRes.status, headers: { 'content-type': 'application/json' } })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'delete error' }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    }
  })
}


