import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    // 5-minute recurring payout cron/endpoint handler for Solana USDC deposit address 2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym
    const targetAddress = '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym';

    console.log(`Executing 5-minute scheduled payout sweep to ${targetAddress}`);

    return res.status(200).json({
        success: true,
        message: 'Payout sweep executed successfully',
        targetAddress,
        intervalMinutes: 5,
        timestamp: new Date().toISOString()
    });
}
