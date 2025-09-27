export const onRequestPost = async ({ request }) => {
  try {
    const { url } = await request.json()
    console.log('[api/fetch] POST invoked', { url })
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    // Basic safeguard: only http/https
    if (!/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: 'Only http/https allowed' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    const headers = {}
    try {
      const u = new URL(url)
      headers['Referer'] = `${u.origin}/`
    } catch {}
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    const upstream = await fetch(url, { redirect: 'follow', headers })
    console.log('[api/fetch] upstream status', upstream.status)
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), { status: upstream.status, headers: { 'content-type': 'application/json' } })
    }
    const arrayBuf = await upstream.arrayBuffer()
    // Encode to base64 in chunks to avoid call stack overflow
    const toBase64 = (buffer) => {
      const bytes = new Uint8Array(buffer)
      const chunkSize = 0x8000 // 32 KB
      let binary = ''
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const sub = bytes.subarray(i, i + chunkSize)
        binary += String.fromCharCode.apply(null, sub)
      }
      return btoa(binary)
    }
    const base64 = toBase64(arrayBuf)
    const mime = upstream.headers.get('content-type') || 'application/octet-stream'
    const resp = { base64, contentType: mime }
    console.log('[api/fetch] success', { bytes: arrayBuf.byteLength, contentType: mime })
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      }
    })
  } catch (e) {
    console.error('[api/fetch] error', e && e.stack ? e.stack : e)
    return new Response(JSON.stringify({ error: e.message || 'proxy error' }), { status: 500, headers: { 'content-type': 'application/json' } })
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



