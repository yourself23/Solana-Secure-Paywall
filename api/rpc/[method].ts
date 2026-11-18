import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleX402 } from '../_lib/x402-settle.js';

const SAFE_RPC_METHODS = new Set([
  'getBalance', 'getAccountInfo', 'getLatestBlockhash', 'getSlot',
  'getTokenAccountsByOwner', 'getTokenSupply', 'getTransaction',
  'getSignaturesForAddress', 'getRecentPrioritizationFees', 'simulateTransaction',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = String(req.query?.method || 'solana').trim();
  if (!['solana', 'price', 'blockhash'].includes(route)) {
    return res.status(404).json({ error: 'Unsupported route', available: ['solana', 'price', 'blockhash'] });
  }
  const rpcMethod = String(req.body?.method || 'getLatestBlockhash');
  if (route === 'solana' && !SAFE_RPC_METHODS.has(rpcMethod)) return res.status(400).json({ error: 'Method not in safe RPC allowlist' });
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  if (!receiver) return res.status(503).json({ error: 'TREASURY_ADDRESS is not configured' });
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
  return handleX402(req, res, receiver, 90000, async () => {
    let data: unknown;
    if (route === 'solana' || route === 'blockhash') {
      const method = route === 'blockhash' ? 'getLatestBlockhash' : rpcMethod;
      const params = route === 'blockhash' ? [{ commitment: 'confirmed' }] : req.body?.params || [];
      const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(`Solana RPC: ${result.error.message || 'request failed'}`);
      data = result;
    } else {
      const mint = String(req.query?.mint || req.body?.mint || 'So11111111111111111111111111111111111111112');
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`);
      if (!response.ok) throw new Error(`DexScreener HTTP ${response.status}`);
      const result = await response.json();
      const top = Array.isArray(result?.pairs) ? result.pairs[0] : null;
      data = { mint, priceUsd: top?.priceUsd || null, liquidityUsd: top?.liquidity?.usd || 0, dexId: top?.dexId || null, pairAddress: top?.pairAddress || null };
    }
    return { route: `/api/rpc/${route}`, data };
  });
}
