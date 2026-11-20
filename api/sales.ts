import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PublicKey } from '@solana/web3.js';
import { getAvailableEngines } from './_lib/engines.js';
import { DEFAULT_PAYMENT_AMOUNT_SOL } from './_lib/pricing.js';

// Public health & treasury metadata only — earnings remain private in authenticated /api/telemetry
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  const amountSol = Number(process.env.PAYMENT_AMOUNT_SOL || DEFAULT_PAYMENT_AMOUNT_SOL);
  const lamports = Math.round(amountSol * 1_000_000_000);
  if (!receiver || !Number.isSafeInteger(lamports) || lamports <= 0 || Math.abs(lamports / 1_000_000_000 - amountSol) > 1e-12) {
    return res.status(503).json({ error: 'Payment configuration missing or invalid' });
  }
  try { new PublicKey(receiver); } catch { return res.status(503).json({ error: 'Invalid treasury address' }); }
  return res.status(200).json({
    status: 'configured',
    protocol: 'x402-v2',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    asset: 'SOL',
    x402Asset: 'wrapped SOL',
    mint: 'So11111111111111111111111111111111111111112',
    treasury: receiver,
    amountSol,
    lamports,
    creditsPerPayment: 10,
    prepaidAvailable: Boolean(process.env.PAYWALL_SECRET?.trim() && process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()),
    availableEngines: getAvailableEngines(),
  });
}
