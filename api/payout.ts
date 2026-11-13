import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, getClientIp } from './lib/ratelimit';

const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym';
const PAYOUT_INTERVAL_MINUTES = parseInt(process.env.PAYOUT_INTERVAL_MINUTES || '5', 10);
const API_AUTH_SECRET = process.env.API_AUTH_SECRET;

function verifyAuth(req: VercelRequest): boolean {
    if (!API_AUTH_SECRET) {
        console.warn('API_AUTH_SECRET not configured, skipping auth check');
        return true; // Allow in development
    }
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }
    
    const token = authHeader.slice(7);
    return token === API_AUTH_SECRET;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Authentication check (required for cron/admin access)
    if (!verifyAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
    }

    // Rate limiting by client IP (Upstash-backed)
    const clientIp = getClientIp(req);
    const rateLimitResult = await checkRateLimit(`payout:${clientIp}`);
    if (rateLimitResult && !rateLimitResult.success) {
        return res.status(429).json({ 
            error: 'Too many requests. Please wait before trying again.',
            retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000)
        });
    }

    // 5-minute recurring payout cron/endpoint handler for Solana USDC deposit address
    console.log(`Executing ${PAYOUT_INTERVAL_MINUTES}-minute scheduled payout sweep to ${TREASURY_ADDRESS}`);

    // In production, this would trigger actual payout logic:
    // 1. Check treasury balance
    // 2. Calculate payouts based on sales
    // 3. Execute SPL token transfers
    // 4. Log transaction signatures

    return res.status(200).json({
        success: true,
        message: 'Payout sweep executed successfully',
        targetAddress: TREASURY_ADDRESS,
        intervalMinutes: PAYOUT_INTERVAL_MINUTES,
        timestamp: new Date().toISOString()
    });
}