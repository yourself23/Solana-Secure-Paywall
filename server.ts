import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServer as createViteServer } from 'vite';
import paywall from './api/paywall.js';
import invoke from './api/v1/invoke.js';
import mcp from './api/mcp.js';
import sales from './api/sales.js';
import telemetry from './api/telemetry.js';
import solanaTool from './api/solana/[tool].js';
import gpuRates from './api/solana/gpu-rates.js';
import rpc from './api/rpc/[method].js';
import sniperStatus from './api/sniper-status.js';

async function startServer() {
  const app = express();
  app.use(express.json());
  const port = Number(process.env.PORT || 3000);

  const route = (handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      const request = Object.create(req);
      Object.defineProperty(request, 'query', { value: { ...req.query, ...req.params } });
      request.url = req.originalUrl;
      Promise.resolve(handler(request as VercelRequest, res as unknown as VercelResponse)).catch(next);
    };

  app.all('/api/paywall', route(paywall));
  app.all('/api/v1/invoke', route(invoke));
  app.all('/api/mcp', route(mcp));
  app.all('/api/sales', route(sales));
  app.all('/api/sniper-status', route(sniperStatus));
  app.all('/api/telemetry', route(telemetry));
  app.all('/api/solana/gpu-rates', route(gpuRates));
  app.all('/api/solana/:tool', route(solanaTool));
  app.all('/api/rpc/:method', route(rpc));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(503).json({ error: error.message });
  });

  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
  const server = app.listen(port, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    process.env.APP_URL ||= `http://localhost:${actualPort}`;
    console.log(`Server running on port ${actualPort}`);
  });
}

startServer();
