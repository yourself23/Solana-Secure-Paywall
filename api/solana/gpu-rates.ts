import type { VercelRequest, VercelResponse } from '@vercel/node';
import { settleX402Header, getSolanaFeePayer } from '../v1/x402-settle.js';

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

async function fetchLiveGpuRates(gpuFilter?: string) {
  const apiUrl = ['https:/', 'console.vast.ai', 'api', 'v0', 'bundles', '?q=%7B%22rentable%22%3A%7B%22eq%22%3Atrue%7D%2C%22order%22%3A%5B%5B%22dph_total%22%2C%22asc%22%5D%5D%2C%22limit%22%3A40%7D'].join('/');
  const r = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`GPU feed HTTP ${r.status}`);
  const data = await r.json();
  const offers = Array.isArray(data?.offers) ? data.offers : [];

  const grouped: Record<string, { gpu: string; availableOffers: number; lowestUsdPerHr: number; topRegions: string[] }> = {};
  for (const o of offers) {
    const name = String(o.gpu_name || 'Unknown').trim();
    if (gpuFilter && !name.toLowerCase().includes(gpuFilter.toLowerCase())) continue;
    const price = Number(o.dph_total || 0);
    if (price <= 0) continue;
    if (!grouped[name]) grouped[name] = { gpu: name, availableOffers: 0, lowestUsdPerHr: price, topRegions: [] };
    grouped[name].availableOffers += 1;
    if (price < grouped[name].lowestUsdPerHr) grouped[name].lowestUsdPerHr = Number(price.toFixed(4));
    const loc = String(o.geolocation || '').trim();
    if (loc && grouped[name].topRegions.length < 3 && !grouped[name].topRegions.includes(loc)) grouped[name].topRegions.push(loc);
  }

  return {
    source: 'live-gpu-marketplace',
    timestamp: new Date().toISOString(),
    models: Object.values(grouped).sort((a, b) => a.lowestUsdPerHr - b.lowestUsdPerHr).slice(0, 12),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim() || '2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2';
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const fallbackRpc = ['https:/', '://solana.com'].join('/');
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || fallbackRpc;

  const upstash = async (cmd: (string | number)[]) => {
    if (!redisUrl || !redisToken) return { result: null };
    const r = await fetch(redisUrl, { method: 'POST', headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    return r.json();
  };

  const logEvent = async (type: string, detail: string) => {
    const entry = JSON.stringify({ ts: new Date().toISOString(), type, detail });
    await upstash(['LPUSH', 'telemetry:events', entry]).catch(() => {});
    await upstash(['LTRIM', 'telemetry:events', 0, 99]).catch(() => {});
    await upstash(['HINCRBY', 'telemetry:stats', type, 1]).catch(() => {});
  };

  const lamports = 130000; // 0.00013 SOL (~$0.0094)
  const amountSol = 0.00013;
  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment']) as string | undefined;

  if (paymentHeader) {
    const feePayer = await getSolanaFeePayer();
    const settled = await settleX402Header(paymentHeader.trim(), receiver, lamports, rpcUrl, upstash, logEvent, feePayer);
    if (!settled.ok || !settled.txSig) {
      return res.status(402).json({ error: settled.error || 'x402 0.00013 SOL settlement failed' });
    }
    const gpuFilter = String(req.query?.gpu || req.body?.gpu || '').trim() || undefined;
    const data = await fetchLiveGpuRates(gpuFilter);
    await upstash(['HINCRBYFLOAT', 'telemetry:stats', 'total_usdc_earned', amountSol]);
    await logEvent('GPU_RATES_PAID', '+0.00013 SOL via /api/solana/gpu-rates');
    res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, transaction: settled.txSig, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' })).toString('base64'));
    return res.status(200).json({ success: true, route: '/api/solana/gpu-rates', txSignature: settled.txSig, data });
  }

  const feePayer = await getSolanaFeePayer();
  const x402Payload = Buffer.from(JSON.stringify({
    x402Version: 2,
    extensions: { bazaar: { info: { input: { type: 'http', method: 'GET', queryParams: { gpu: 'H100' } }, output: { type: 'json', example: { success: true, route: '/api/solana/gpu-rates', data: { models: [] } } } } } },
    accepts: [{ scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', amount: lamports.toString(), asset: NATIVE_SOL_MINT, payTo: receiver, maxTimeoutSeconds: 300, mimeType: 'application/json', extra: { feePayer }, description: 'Live cloud GPU rental hourly rates & availability (H100, A100, RTX 4090) — 0.00013 SOL' }],
  })).toString('base64');

  await logEvent('CRAWLER_PROBE_402', 'Served 0.00013 SOL x402 quote on /api/solana/gpu-rates');
  res.setHeader('PAYMENT-REQUIRED', x402Payload);
  res.setHeader('X-Payment-Required', 'true');
  res.setHeader('X-Payment-Amount', lamports.toString());
  res.setHeader('X-Payment-Recipient', receiver);
  res.setHeader('X-Payment-Network', 'solana-mainnet');
  res.setHeader('X-Payment-Asset', 'SOL');

  return res.status(402).json({ error: 'Payment Required', x402Version: 2, route: '/api/solana/gpu-rates', amountSol, amountBaseUnits: lamports, depositAddress: receiver });
}
