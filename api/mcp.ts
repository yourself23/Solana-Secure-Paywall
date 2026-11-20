import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAvailableEngines, runLiveSolanaEngine } from './_lib/engines.js';
import { handleX402 } from './_lib/x402-settle.js';
import { DEFAULT_PAYMENT_AMOUNT_SOL } from './_lib/pricing.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST for MCP requests' });
  const { id, method, params } = req.body || {};
  if (method === 'notifications/initialized') return res.status(202).end();
  if (method === 'initialize') {
    return res.status(200).json({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'solana-x402-gateway', version: '1.0.0' } } });
  }
  if (method === 'tools/list') {
    return res.status(200).json({
      jsonrpc: '2.0', id,
      result: { tools: getAvailableEngines().map((name) => ({
        name,
        description: `${name} on Solana Mainnet; swap plans are unsigned`,
        inputSchema: { type: 'object', properties: {
          targetWallet: { type: 'string' }, mint: { type: 'string' }, inputMint: { type: 'string' },
          outputMint: { type: 'string' }, userPublicKey: { type: 'string' },
          amount: { type: 'string', description: 'Input amount in atomic units' }, takingAmount: { type: 'string', description: 'Limit order output amount in atomic units' }, slippageBps: { type: 'integer' },
          transactions: { type: 'array', items: { type: 'string' }, description: 'Unsigned base64 transactions for a Jito bundle plan' },
          tipPayer: { type: 'string' }, tipLamports: { type: 'integer' },
        } },
      })) },
    });
  }
  if (method === 'tools/call') {
    const toolName = String(params?.name || '');
    if (!getAvailableEngines().includes(toolName)) {
      return res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown or unavailable tool' } });
    }
    const receiver = process.env.TREASURY_ADDRESS?.trim();
    if (!receiver) return res.status(503).json({ error: 'TREASURY_ADDRESS is not configured' });
    const amount = Number(process.env.PAYMENT_AMOUNT_SOL || DEFAULT_PAYMENT_AMOUNT_SOL);
    const lamports = Math.round(amount * 1_000_000_000);
    return handleX402(req, res, receiver, lamports, async () => {
      const data = await runLiveSolanaEngine(toolName, process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com', params?.arguments || {});
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } };
    });
  }
  return res.status(200).json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Method not found' } });
}
