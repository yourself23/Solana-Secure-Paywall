import express from 'express';
import {createServer as createViteServer} from 'vite';

async function startServer() {
    const app = express();
    app.use(express.json());

    // Payout logic
    setInterval(async () => {
        console.log("Performing scheduled payout check...");
        // Here you would integrate the Solana transaction logic for payouts.
    }, 5 * 60 * 1000);

    // API routes
    app.post('/api/paywall', (req, res) => {
        // Handle paywall interaction
        res.json({success: true});
    });

    const vite = await createViteServer({
        server: {middlewareMode: true},
        appType: 'spa'
    });

    app.use(vite.middlewares);

    app.listen(3000, () => console.log('Server running on port 3000'));
}

startServer();
