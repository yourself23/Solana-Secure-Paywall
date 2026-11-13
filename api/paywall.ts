import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { verifyAndCreditPayment } from './lib/credit-store';
import { checkRateLimit, getClientIp } from './lib/ratelimit';

const PAYWALL_SCHEMA = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid Base transaction hash'),
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM wallet address'),
  libraryId: z.string().min(1, 'Library ID is required'),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const treasury = process.env.TREASURY_ADDRESS;
  if (!treasury) {
    return res.status(500).json({ error: 'Server configuration incomplete' });
  }

  const minUnits = process.env.USDC_MIN_UNITS || '100000';

  if (req.method !== 'POST') {
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', minUnits);
    res.setHeader('X-Payment-Recipient', treasury);
    res.setHeader('X-Payment-Network', 'base-mainnet');
    res.setHeader('X-Payment-Asset', 'USDC');
    return res.status(402).json({
      error: 'Payment Required',
      network: 'base-mainnet',
      asset: 'USDC',
      recipient: treasury,
      minUnits,
      trialCallsAvailable: 2,
    });
  }

  const clientIp = getClientIp(req);
  const rateLimitResult = await checkRateLimit(`paywall:${clientIp}`);
  if (rateLimitResult && !rateLimitResult.success) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
    });
  }

  const parseResult = PAYWALL_SCHEMA.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { txHash, wallet, libraryId } = parseResult.data;

  try {
    const result = await verifyAndCreditPayment(txHash, wallet, libraryId);
    if (!result.success) {
      return res.status(402).json({ error: result.error, code: 'PAYMENT_VERIFICATION_FAILED' });
    }
    return res.status(200).json({
      success: true,
      credits: result.credits,
      message: 'Base USDC payment verified and credits granted',
    });
  } catch (err: any) {
    return res.status(503).json({ error: 'Upstream RPC unavailable', details: err?.message });
  }
}
