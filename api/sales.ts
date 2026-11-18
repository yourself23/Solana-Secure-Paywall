import type { VercelRequest, VercelResponse } from '@vercel/node';

// Public health & treasury metadata only — earnings remain private in authenticated /api/telemetry
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim() || '2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2';
  return res.status(200).json({
    status: 'operational',
    protocol: 'x402-v2',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    asset: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    treasury: receiver,
    endpointsCount: 13,
    mcpEnginesCount: 24,
  });
}
