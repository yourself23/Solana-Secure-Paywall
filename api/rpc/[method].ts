import type { VercelRequest, VercelResponse } from '@vercel/node';
import { settleX402Header, getSolanaFeePayer } from '../v1/x402-settle.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SAFE_RPC_METHODS = new Set([
  'getBalance', 'getAccountInfo', 'getLatestBlockhash', 'getSlot',
  'getTokenAccountsByOwner', 'getTokenSupply', 'getTransaction',
  'getSignaturesForAddress', 'getRecentPrioritizationFees', 'simulateTransaction', 'sendTransaction'
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim() || '2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2';
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const fallbackRpc = ['https:/', '://solana.com'].join('/');
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || fallbackRpc;

  const route = String(req.query?.method || 'solana').trim();
  if (!['solana', 'quote', 'price', 'blockhash'].includes(route)) {
    return res.status(404).json({ error: 'Unsupported route', available: ['solana', 'quote', 'price', 'blockhash'] });
  }

  const upstash = async (cmd: (string | number)[]) => {
    if (!redisUrl || !redisToken) return { result: null };
    const r = await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return r.json();
  };

  const logEvent = async (type: string, detail: string) => {
    const entry = JSON.stringify({ ts: new Date().toISOString(), type, detail });
    await upstash(['LPUSH', 'telemetry:events', entry]).catch(() => {});
    await upstash(['LTRIM', 'telemetry:events', 0, 99]).catch(() => {});
    await upstash(['HINCRBY', 'telemetry:stats', type, 1]).catch(() => {});
  };

  const units = 5000; // $0.005 USDC (50% cheaper than $0.01 competitors)
  const amountUsdc = 0.005;
  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment']) as string | undefined;

  if (paymentHeader) {
    const feePayer = await getSolanaFeePayer();
    const settled = await settleX402Header(paymentHeader.trim(), receiver, units, rpcUrl, upstash, logEvent, feePayer);
    if (!settled.ok || !settled.txSig) {
      return res.status(402).json({ error: settled.error || 'x402 $0.005 USDC settlement failed' });
    }

    let resultData: any = null;
    if (route === 'solana') {
      const rpcMethod = String(req.body?.method || 'getLatestBlockhash');
      if (!SAFE_RPC_METHODS.has(rpcMethod)) return res.status(400).json({ error: 'Method not in safe RPC allowlist' });
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: rpcMethod, params: req.body?.params || [] }),
      });
      resultData = await r.json();
    } else if (route === 'blockhash') {
      const cached = await upstash(['GET', 'cache:solana:blockhash']);
      if (cached?.result) {
        resultData = JSON.parse(cached.result);
      } else {
        const r = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: 'confirmed' }] }) });
        resultData = await r.json();
        await upstash(['SET', 'cache:solana:blockhash', JSON.stringify(resultData), 'EX', 2]);
      }
    } else {
      const mint = String(req.query?.mint || req.body?.mint || 'So11111111111111111111111111111111111111112');
      const dexUrl = ['https:/', '://dexscreener.com', 'latest', 'dex', 'tokens', mint].join('/');
      const r = await fetch(dexUrl);
      const j = await r.json();
      const top = Array.isArray(j?.pairs) ? j.pairs[0] : null;
      resultData = { mint, priceUsd: top?.priceUsd || null, liquidityUsd: top?.liquidity?.usd || 0, dexId: top?.dexId || null, pairAddress: top?.pairAddress || null };
    }

    await upstash(['HINCRBYFLOAT', 'telemetry:stats', 'total_usdc_earned', amountUsdc]);
    await logEvent('RPC_PAID_0005', `+$0.005 USDC via /api/rpc/${route}`);
    res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, transaction: settled.txSig, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' })).toString('base64'));
    return res.status(200).json({ success: true, route: `/api/rpc/${route}`, txSignature: settled.txSig, data: resultData });
  }

  const feePayer = await getSolanaFeePayer();
  const x402Payload = Buffer.from(JSON.stringify({
    x402Version: 2,
    extensions: {
      bazaar: {
        info: {
          input: { type: 'http', method: route === 'solana' ? 'POST' : 'GET' },
          output: { type: 'json', example: { success: true, route: `/api/rpc/${route}`, data: {} } },
        },
      },
    },
    accepts: [{
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      amount: units.toString(),
      asset: USDC_MINT,
      payTo: receiver,
      maxTimeoutSeconds: 300,
      mimeType: 'application/json',
      extra: { feePayer },
      description: `Ultra-low-cost Solana Mainnet ${route} endpoint ($0.005 USDC — 50% below standard market rate)`,
    }],
  })).toString('base64');

  await logEvent('CRAWLER_PROBE_402', `Served $0.005 x402 quote on /api/rpc/${route}`);
  res.setHeader('PAYMENT-REQUIRED', x402Payload);
  res.setHeader('X-Payment-Required', 'true');
  res.setHeader('X-Payment-Amount', units.toString());
  res.setHeader('X-Payment-Recipient', receiver);
  res.setHeader('X-Payment-Network', 'solana-mainnet');
  res.setHeader('X-Payment-Asset', 'USDC');

  return res.status(402).json({ error: 'Payment Required', x402Version: 2, route: `/api/rpc/${route}`, amountUsdc, amountBaseUnits: units, depositAddress: receiver });
}
