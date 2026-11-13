import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { verifyAndCreditPayment } from './lib/credit-store';
import { checkRateLimit, getClientIp } from './lib/ratelimit';

const PAYWALL_SCHEMA = z.object({
  signature: z.string().min(1, 'Transaction signature is required'),
  wallet: z.string().min(32, 'Invalid wallet address').max(44, 'Invalid wallet address'),
  libraryId: z.string().min(1, 'Library ID is required'),
});

const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym';
const PAYMENT_AMOUNT_SOL = parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1');
const PAYMENT_LAMPORTS = Math.round(PAYMENT_AMOUNT_SOL * 1_000_000_000);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', PAYMENT_LAMPORTS.toString());
    res.setHeader('X-Payment-Recipient', TREASURY_ADDRESS);
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'SOL');
    return res.status(402).json({
      error: 'Payment Required',
      network: 'solana-mainnet',
      asset: 'SOL',
      recipient: TREASURY_ADDRESS,
      amountLamports: PAYMENT_LAMPORTS,
      amountSol: PAYMENT_AMOUNT_SOL,
      trialCallsAvailable: 2,
    });
  }

  const clientIp = getClientIp(req);
  const rateLimitResult = await checkRateLimit(`paywall:${clientIp}`);
  if (rateLimitResult && !rateLimitResult.success) {
    return res.status(429).json({ 
      error: 'Too many requests. Please wait before trying again.',
      retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000)
    });
  }

  const parseResult = PAYWALL_SCHEMA.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ 
      error: 'Invalid request body', 
      details: parseResult.error.flatten().fieldErrors 
    });
  }

  const { signature, wallet, libraryId } = parseResult.data;
  
  try {
    const result = await verifyAndCreditPayment(signature, wallet, libraryId);
    if (!result.success) {
      return res.status(402).json({ error: result.error, code: 'PAYMENT_VERIFICATION_FAILED' });
    }
    return res.status(200).json({ 
      success: true, 
      credits: result.credits,
      message: 'Payment verified and credits granted'
    });
  } catch (err: any) {
    return res.status(503).json({ error: 'Upstream RPC unavailable', details: err?.message });
  }
}
