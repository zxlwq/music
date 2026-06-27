import { runUserDataSync } from '../lib/sync.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: '方法不允许' });
    return;
  }

  try {
    const { status, body } = await runUserDataSync(req.body, process.env, {
      builtinProxyUrl: '/api/audio',
    });
    res.status(status).json(body);
  } catch (e) {
    console.error('Gist error:', e);
    res.status(500).json({ error: e.message || 'Gist 操作失败' });
  }
}
