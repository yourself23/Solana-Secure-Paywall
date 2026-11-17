import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runLiveSolanaEngine } from '../v1/engines.js';
import { settleX402Header, getSolanaFeePayer } from '../v1/x402-settle.js';

const TOOL_MAP: Record<string, string> = {
  whales: 'whale-wallet-tracker',
  'rug-check': 'rug-pull-mint-auditor',
  fees: 'priority-fee-oracle',
  pools: 'liquidity-pool-sniffer',
  alpha: 'mempool-alpha-scanner',
  boosts: 'token-boost-radar',
};

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim() || '2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2';
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const fallbackRpc = ['https:/', '://solana.com'].join('/');
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || fallbackRpc;

  const toolSlug = String(req.query?.tool || 'whales').trim();
  const engineId = TOOL_MAP[toolSlug];
  if (!engineId) {
    return res.status(404).json({ error: 'Unknown tool route', available: Object.keys(TOOL_MAP) });
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

  const units = 10000; // $0.01 USDC
  const amountUsdc = 0.01;
  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment']) as string | undefined;

  if (paymentHeader) {
    const settled = await settleX402Header(paymentHeader.trim(), receiver, units, rpcUrl, upstash, logEvent);
    if (!settled.ok || !settled.txSig) {
      return res.status(402).json({ error: settled.error || 'x402 $0.01 USDC settlement failed' });
    }
    const params = { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) };
    const data = await runLiveSolanaEngine(engineId, rpcUrl, params);
    await upstash(['HINCRBYFLOAT', 'telemetry:stats', 'total_usdc_earned', amountUsdc]);
    await logEvent('MICRO_PAID_001', `+$0.01 USDC via /api/solana/${toolSlug}`);
    res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, transaction: settled.txSig, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' })).toString('base64'));
    return res.status(200).json({ success: true, route: `/api/solana/${toolSlug}`, txSignature: settled.txSig, data });
  }

  const feePayer = await getSolanaFeePayer();
  const x402Payload = Buffer.from(JSON.stringify({
    x402Version: 2,
    extensions: {
      bazaar: {
        info: {
          input: { type: 'http', method: 'GET', queryParams: { targetWallet: '', mint: '' } },
          output: { type: 'json', example: { success: true, route: `/api/solana/${toolSlug}`, data: { network: 'solana-mainnet' } } },
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
      description: `Live Solana Mainnet ${toolSlug} intelligence ($0.01 USDC)`,
    }],
  })).toString('base64');

  await logEvent('CRAWLER_PROBE_402', `Served $0.01 x402 quote on /api/solana/${toolSlug}`);
  res.setHeader('PAYMENT-REQUIRED', x402Payload);
  res.setHeader('X-Payment-Required', 'true');
  res.setHeader('X-Payment-Amount', units.toString());
  res.setHeader('X-Payment-Recipient', receiver);
  res.setHeader('X-Payment-Network', 'solana-mainnet');
  res.setHeader('X-Payment-Asset', 'USDC');

  return res.status(402).json({
    error: 'Payment Required',
    x402Version: 2,
    route: `/api/solana/${toolSlug}`,
    amountUsdc,
    amountBaseUnits: units,
    depositAddress: receiver,
  });
}
