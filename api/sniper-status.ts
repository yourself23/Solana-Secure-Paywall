import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sniperJobKey, sniperRedis, validSniperJobId } from './_lib/sniper-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  const secret = process.env.SNIPER_STATUS_SECRET?.trim();
  const authorization = req.headers.authorization || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!secret) return res.status(503).json({ error: 'Sniper status is not configured' });
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Unauthorized' });

  const id = String(req.query?.id || '');
  if (!validSniperJobId(id)) return res.status(400).json({ error: 'Valid job id required' });
  try {
    const result = await sniperRedis(['GET', sniperJobKey(id)]);
    if (!result) return res.status(404).json({ error: 'Job not found or not yet polled' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(JSON.parse(result));
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Sniper status unavailable' });
  }
}
