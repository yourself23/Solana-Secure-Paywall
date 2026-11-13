import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Connection, ParsedTransactionWithMeta } from '@solana/web3.js';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { z } from 'zod';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
});

const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://solana.com',
  'confirmed'
);

const PAYWALL_SCHEMA = z.object({
  signature: z.string().min(64, 'Invalid transaction signature').max(100),
  wallet: z.string().min(32, 'Invalid Solana wallet address').max(44),
  libraryId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().default('default'),
});

function getLamportsReceived(tx: ParsedTransactionWithMeta, receiver: string): number {
  if (!tx.meta || tx.meta.err) return 0;
  const idx = tx.transaction.message.accountKeys.findIndex(
    (k) => k.pubkey.toBase58() === receiver
  );
  if (idx === -1) return 0;
  return (tx.meta.postBalances[idx] ?? 0) - (tx.meta.preBalances[idx] ?? 0);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS;
  if (!receiver) {
    return res.status(500).json({ error: 'Server configuration incomplete: TREASURY_ADDRESS missing' });
  }

  const amountSol = parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1');
  const requiredLamports = Math.round(amountSol * 1_000_000_000);
  const callsPerPayment = Number(process.env.API_CALLS_PER_PAYMENT || '60');

  if (req.method !== 'POST') {
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', requiredLamports.toString());
    res.setHeader('X-Payment-Recipient', receiver);
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'SOL');
    return res.status(402).json({
      error: 'Payment Required',
      network: 'solana-mainnet',
      asset: 'SOL',
      depositAddress: receiver,
      amountLamports: requiredLamports,
      amountSol,
    });
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded?.split(',')[0] || 'anonymous');
  const { success: withinLimit } = await ratelimit.limit(`paywall:${ip}`);
  if (!withinLimit) {
    return res.status(429).json({ error: 'Too many requests. Please wait before retrying.' });
  }

  const parsed = PAYWALL_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { signature, wallet, libraryId } = parsed.data;
  const sigKey = `spent_sol_sig:${signature}`;

  const claimed = await redis.set(sigKey, wallet, { nx: true, ex: 86400 * 30 });
  if (claimed !== 'OK') {
    return res.status(402).json({ error: 'Transaction signature already redeemed' });
  }

  try {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      await redis.del(sigKey);
      return res.status(402).json({ error: 'Transaction not found or not yet confirmed on-chain' });
    }

    if (tx.meta?.err) {
      await redis.del(sigKey);
      return res.status(402).json({ error: 'Transaction failed on-chain' });
    }

    const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
    if (signer !== wallet) {
      await redis.del(sigKey);
      return res.status(402).json({ error: 'Transaction signer does not match requesting wallet' });
    }

    const receivedLamports = getLamportsReceived(tx, receiver);
    if (receivedLamports < requiredLamports) {
      await redis.del(sigKey);
      return res.status(402).json({
        error: `Insufficient SOL transfer: received ${receivedLamports} lamports, expected ${requiredLamports}`,
      });
    }

    const newCredits = await redis.hincrby(`credits:${wallet}`, libraryId, callsPerPayment);

    return res.status(200).json({
      success: true,
      message: 'Paywall access granted',
      depositAddress: receiver,
      credits: newCredits,
      amount: amountSol,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    await redis.del(sigKey);
    return res.status(503).json({
      error: 'Solana RPC verification unavailable',
      details: err?.message || 'Unknown RPC error',
    });
  }
}
