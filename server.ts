import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym';

async function startServer() {
    const app = express();

    app.use(express.json());

    // Local development API fallbacks (no auth, no rate limiting - Vercel handles production)
    app.post('/api/paywall', (req, res) => {
        const { signature, wallet, amount } = req.body || {};

        if (!signature || !wallet) {
            return res.status(400).json({ error: 'Missing transaction signature or wallet address' });
        }

        console.log(`[${new Date().toISOString()}] [DEV] Paywall verified for wallet ${wallet} with signature ${signature}`);

        const paymentAmount = amount || parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1');
        const callsPerPayment = parseInt(process.env.API_CALLS_PER_PAYMENT || '60', 10);

        return res.json({
            success: true,
            message: 'Paywall access granted (dev)',
            depositAddress: TREASURY_ADDRESS,
            amount: paymentAmount,
            callsGranted: callsPerPayment,
            timestamp: new Date().toISOString()
        });
    });

    app.post('/api/payout', (req, res) => {
        console.log(`[${new Date().toISOString()}] [DEV] Payout sweep triggered manually`);
        
        return res.json({
            success: true,
            message: 'Payout sweep triggered manually (dev)',
            targetAddress: TREASURY_ADDRESS,
            intervalMinutes: parseInt(process.env.PAYOUT_INTERVAL_MINUTES || '5', 10),
            timestamp: new Date().toISOString()
        });
    });

    app.get('/api/health', (req, res) => {
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            treasury: TREASURY_ADDRESS.slice(0, 6) + '...' + TREASURY_ADDRESS.slice(-6)
        });
    });

    const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa'
    });

    app.use(vite.middlewares);

    app.listen(3000, () => console.log('Dev server running on port 3000'));
}

startServer();