import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.TELEMETRY_SECRET?.trim();
  const auth = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!secret || auth !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!redisUrl || !redisToken) return res.status(500).json({ error: 'Redis missing' });

  const upstash = async (cmd: (string | number)[]) => {
    const r = await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return r.json();
  };

  const [statsRes, eventsRes] = await Promise.all([
    upstash(['HGETALL', 'telemetry:stats']),
    upstash(['LRANGE', 'telemetry:events', 0, 24]),
  ]);

  const rawStats = statsRes.result || [];
  const stats: Record<string, string> = {};
  for (let i = 0; i < rawStats.length; i += 2) stats[rawStats[i]] = rawStats[i + 1];

  const events = (eventsRes.result || []).map((item: string) => {
    try { return JSON.parse(item); } catch { return { raw: item }; }
  });

  return res.status(200).json({ treasury: process.env.TREASURY_ADDRESS, stats, recentEvents: events, serverTime: new Date().toISOString() });
}
