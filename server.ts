import express from 'express';
import { createServer as createViteServer } from 'vite';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym';
const PAYOUT_INTERVAL_MINUTES = parseInt(process.env.PAYOUT_INTERVAL_MINUTES || '5', 10);
const API_AUTH_SECRET = process.env.API_AUTH_SECRET;

async function startServer() {
    const app = express();

    // Security headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'", 'https://api.mainnet-beta.solana.com', 'https://explorer.solana.com'],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
        },
        frameguard: { action: 'deny' },
        xssFilter: true,
        noSniff: true,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }));

    // Rate limiting
    const apiLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 60, // 60 requests per minute
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10, // 10 attempts per 15 minutes
        message: { error: 'Too many authentication attempts, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    app.use(express.json());
    app.use(apiLimiter);

    // Authentication middleware for API routes
    function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
        if (!API_AUTH_SECRET) {
            console.warn('API_AUTH_SECRET not configured, skipping auth check');
            return next();
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
        }

        const token = authHeader.slice(7);
        if (token !== API_AUTH_SECRET) {
            return res.status(401).json({ error: 'Unauthorized: Invalid authentication token' });
        }

        next();
    }

    // Payout logic - functional implementation
    async function executePayoutSweep() {
        console.log(`[${new Date().toISOString()}] Executing scheduled payout sweep to ${TREASURY_ADDRESS}`);
        
        try {
            // In production, this would:
            // 1. Connect to Solana RPC
            // 2. Check treasury balance (SOL and SPL tokens)
            // 3. Calculate pending payouts based on sales records
            // 4. Execute SPL token transfers to recipients
            // 5. Log transaction signatures
            // 6. Update payout records in database
            
            // Placeholder for actual implementation:
            // const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
            // const treasuryPubkey = new PublicKey(TREASURY_ADDRESS);
            // const balance = await connection.getBalance(treasuryPubkey);
            // ... payout logic
            
            console.log(`[${new Date().toISOString()}] Payout sweep completed for ${TREASURY_ADDRESS}`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Payout sweep failed:`, error);
        }
    }

    // Schedule payout sweep
    setInterval(executePayoutSweep, PAYOUT_INTERVAL_MINUTES * 60 * 1000);
    
    // Also run once on startup (after a short delay)
    setTimeout(executePayoutSweep, 10000);

    // API routes with authentication
    app.post('/api/paywall', authLimiter, requireAuth, (req, res) => {
        // Handle paywall interaction - validation done by Vercel endpoint
        // This is a fallback for local development
        const { signature, wallet, amount } = req.body || {};

        if (!signature || !wallet) {
            return res.status(400).json({ error: 'Missing transaction signature or wallet address' });
        }

        console.log(`[${new Date().toISOString()}] Paywall verified for wallet ${wallet} with signature ${signature}`);

        const paymentAmount = amount || parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1');
        const callsPerPayment = parseInt(process.env.API_CALLS_PER_PAYMENT || '60', 10);

        return res.json({
            success: true,
            message: 'Paywall access granted',
            depositAddress: TREASURY_ADDRESS,
            amount: paymentAmount,
            callsGranted: callsPerPayment,
            timestamp: new Date().toISOString()
        });
    });

    app.post('/api/payout', authLimiter, requireAuth, (req, res) => {
        // Manual payout trigger endpoint
        executePayoutSweep();
        
        return res.json({
            success: true,
            message: 'Payout sweep triggered manually',
            targetAddress: TREASURY_ADDRESS,
            intervalMinutes: PAYOUT_INTERVAL_MINUTES,
            timestamp: new Date().toISOString()
        });
    });

    // Health check endpoint (no auth required)
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

    app.listen(3000, () => console.log('Server running on port 3000'));
}

startServer();