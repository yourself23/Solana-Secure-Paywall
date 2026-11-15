import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim() || '';
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!redisUrl || !redisToken) {
    return res.status(200).json({ treasury: receiver, totalUsdc: 0, salesCount: 0, recentSales: [] });
  }

  try {
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
      upstash(['LRANGE', 'telemetry:events', 0, 29]),
    ]);

    const rawStats = statsRes.result || [];
    const stats: Record<string, string> = {};
    for (let i = 0; i < rawStats.length; i += 2) stats[rawStats[i]] = rawStats[i + 1];

    const recentSales = (eventsRes.result || [])
      .map((item: string) => { try { return JSON.parse(item); } catch { return null; } })
      .filter((e: any) => e && (e.type === 'PAYMENT_VERIFIED' || e.type === 'AGENTCASH_PAID'));

    return res.status(200).json({
      treasury: receiver,
      totalUsdc: parseFloat(stats.total_usdc_earned || '0'),
      salesCount: Number(stats.PAYMENT_VERIFIED || 0) + Number(stats.AGENTCASH_PAID || 0),
      recentSales,
    });
  } catch {
    return res.status(200).json({ treasury: receiver, totalUsdc: 0, salesCount: 0, recentSales: [] });
  }
}
