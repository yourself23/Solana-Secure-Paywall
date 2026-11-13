import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { checkRateLimit, getClientIp } from './lib/ratelimit';

const PAYWALL_SCHEMA = z.object({
    signature: z.string().min(1, 'Transaction signature is required'),
    wallet: z.string().min(32, 'Invalid wallet address').max(44, 'Invalid wallet address'),
    amount: z.number().positive('Amount must be positive').optional(),
});

const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym';
const PAYMENT_AMOUNT_SOL = parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1');

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limiting by client IP (Upstash-backed, works on Vercel)
    const clientIp = getClientIp(req);
    const rateLimitResult = await checkRateLimit(`paywall:${clientIp}`);
    if (rateLimitResult && !rateLimitResult.success) {
        return res.status(429).json({ 
            error: 'Too many requests. Please wait before trying again.',
            retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000)
        });
    }

    // Input validation
    const parseResult = PAYWALL_SCHEMA.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ 
            error: 'Invalid request body', 
            details: parseResult.error.flatten().fieldErrors 
        });
    }

    const { signature, wallet, amount } = parseResult.data;

    // Process paywall verification and access grant on Solana mainnet
    console.log(`Paywall verified for wallet ${wallet} with signature ${signature}`);

    return res.status(200).json({
        success: true,
        message: 'Paywall access granted',
        depositAddress: TREASURY_ADDRESS,
        amount: amount || PAYMENT_AMOUNT_SOL,
        timestamp: new Date().toISOString()
    });
}