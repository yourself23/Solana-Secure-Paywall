import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

let ratelimit: Ratelimit | null = null;

if (redisUrl && redisToken) {
    const redis = new Redis({
        url: redisUrl,
        token: redisToken,
    });
    ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, '60 s'),
        analytics: true,
        prefix: 'ratelimit:paywall',
    });
}

export async function checkRateLimit(identifier: string): Promise<{ success: boolean; remaining: number; reset: number } | null> {
    if (!ratelimit) {
        console.warn('Upstash not configured, skipping rate limit');
        return null;
    }
    return ratelimit.limit(identifier);
}

export function getClientIp(req: any): string {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           'unknown';
}