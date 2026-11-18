import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runLiveSolanaEngine } from '../_lib/engines.js';
import { handleX402 } from '../_lib/x402-settle.js';

const TOOL_MAP: Record<string, string> = {
  whales: 'whale-wallet-tracker',
  'rug-check': 'rug-pull-mint-auditor',
  fees: 'priority-fee-oracle',
  pools: 'liquidity-pool-sniffer',
  boosts: 'token-boost-radar',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const toolSlug = String(req.query?.tool || 'whales').trim();
  const engineId = TOOL_MAP[toolSlug];
  if (!engineId) return res.status(404).json({ error: 'Unknown or unavailable tool route', available: Object.keys(TOOL_MAP) });
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  if (!receiver) return res.status(503).json({ error: 'TREASURY_ADDRESS is not configured' });
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
  return handleX402(req, res, receiver, 100000, async () => {
    const params = { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) };
    const data = await runLiveSolanaEngine(engineId, rpcUrl, params);
    return { route: `/api/solana/${toolSlug}`, data };
  });
}
