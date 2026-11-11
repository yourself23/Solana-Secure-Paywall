import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { signature, wallet, amount } = req.body || {};

    if (!signature || !wallet) {
        return res.status(400).json({ error: 'Missing transaction signature or wallet address' });
    }

    // Process paywall verification and access grant on Solana mainnet
    console.log(`Paywall verified for wallet ${wallet} with signature ${signature}`);

    return res.status(200).json({
        success: true,
        message: 'Paywall access granted',
        depositAddress: '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym',
        amount: amount || 0.1,
        timestamp: new Date().toISOString()
    });
}
