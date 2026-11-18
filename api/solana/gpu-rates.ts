import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleX402 } from '../_lib/x402-settle.js';

async function fetchLiveGpuRates(gpuFilter?: string) {
  const query = JSON.stringify({ rentable: { eq: true }, order: [['dph_total', 'asc']], limit: 40 });
  const r = await fetch(`https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`GPU feed HTTP ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data?.offers)) throw new Error('GPU feed returned an invalid response');

  const grouped: Record<string, { gpu: string; availableOffers: number; lowestUsdPerHr: number; topRegions: string[] }> = {};
  for (const offer of data.offers) {
    const name = String(offer.gpu_name || 'Unknown').trim();
    if (gpuFilter && !name.toLowerCase().includes(gpuFilter.toLowerCase())) continue;
    const price = Number(offer.dph_total || 0);
    if (price <= 0) continue;
    if (!grouped[name]) grouped[name] = { gpu: name, availableOffers: 0, lowestUsdPerHr: price, topRegions: [] };
    grouped[name].availableOffers += 1;
    if (price < grouped[name].lowestUsdPerHr) grouped[name].lowestUsdPerHr = Number(price.toFixed(4));
    const location = String(offer.geolocation || '').trim();
    if (location && grouped[name].topRegions.length < 3 && !grouped[name].topRegions.includes(location)) grouped[name].topRegions.push(location);
  }
  return { source: 'live-gpu-marketplace', timestamp: new Date().toISOString(), models: Object.values(grouped).sort((a, b) => a.lowestUsdPerHr - b.lowestUsdPerHr).slice(0, 12) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  if (!receiver) return res.status(503).json({ error: 'TREASURY_ADDRESS is not configured' });
  return handleX402(req, res, receiver, 130000, async () => {
    const gpuFilter = String(req.query?.gpu || req.body?.gpu || '').trim() || undefined;
    return { route: '/api/solana/gpu-rates', data: await fetchLiveGpuRates(gpuFilter) };
  });
}
