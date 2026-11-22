import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAvailableEngines, runLiveSolanaEngine } from './_lib/engines.js';
import { handleX402 } from './_lib/x402-settle.js';
import { DEFAULT_PAYMENT_AMOUNT_SOL } from './_lib/pricing.js';

const properties = {
  targetWallet: { type: 'string' }, mint: { type: 'string' }, inputMint: { type: 'string' },
  outputMint: { type: 'string' }, userPublicKey: { type: 'string' }, votePubkey: { type: 'string' },
  amount: { type: 'string', description: 'Input amount in atomic units' },
  takingAmount: { type: 'string', description: 'Limit order output amount in atomic units' },
  minOutputAmount: { type: 'string', description: 'Minimum swap output in atomic units' },
  slippageBps: { type: 'integer', minimum: 1, maximum: 10000 },
  transactions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5, description: 'Unsigned base64 transactions for a Jito bundle plan' },
  tipPayer: { type: 'string' }, tipLamports: { type: 'integer', minimum: 1000 },
};
const inputFields: Record<string, { fields: (keyof typeof properties)[]; required?: string[] }> = {
  'whale-wallet-tracker': { fields: ['targetWallet'] },
  'rug-pull-mint-auditor': { fields: ['mint'], required: ['mint'] },
  'holder-concentration-analyzer': { fields: ['mint'], required: ['mint'] },
  'liquidity-pool-sniffer': { fields: ['mint'], required: ['mint'] },
  'dex-volume-surge-detector': { fields: ['mint'], required: ['mint'] },
  'spl-token-metadata-resolver': { fields: ['mint'], required: ['mint'] },
  'pump-fun-bonding-curve': { fields: ['mint'], required: ['mint'] },
  'validator-stake-tracker': { fields: ['votePubkey'] },
  'jito-bundle-dispatcher': { fields: ['transactions', 'tipPayer', 'tipLamports'], required: ['transactions', 'tipPayer', 'tipLamports'] },
  'multi-wallet-jito-injector': { fields: ['transactions', 'tipPayer', 'tipLamports'], required: ['transactions', 'tipPayer', 'tipLamports'] },
  'cross-dex-router': { fields: ['inputMint', 'outputMint', 'userPublicKey', 'amount', 'slippageBps', 'minOutputAmount'], required: ['inputMint', 'outputMint', 'userPublicKey', 'amount'] },
  'raydium-swap-automator': { fields: ['inputMint', 'outputMint', 'userPublicKey', 'amount', 'slippageBps', 'minOutputAmount'], required: ['inputMint', 'outputMint', 'userPublicKey', 'amount'] },
  'limit-order-sniper': { fields: ['inputMint', 'outputMint', 'userPublicKey', 'amount', 'takingAmount'], required: ['inputMint', 'outputMint', 'userPublicKey', 'amount', 'takingAmount'] },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST for MCP requests' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' ||
      typeof body.method !== 'string' || ('id' in body && body.id !== null && typeof body.id !== 'string' && typeof body.id !== 'number')) {
    return res.status(200).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  }
  const { id, method, params } = body;
  if (method === 'notifications/initialized') return res.status(202).end();
  if (!('id' in body)) return res.status(202).end();
  if (method === 'ping') return res.status(200).json({ jsonrpc: '2.0', id, result: {} });
  if (method === 'initialize') {
    return res.status(200).json({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'solana-x402-gateway', version: '1.0.0' } } });
  }
  if (method === 'tools/list') {
    return res.status(200).json({
      jsonrpc: '2.0', id,
      result: { tools: getAvailableEngines().map((name) => ({
        name,
        description: `${name} on Solana Mainnet; swap plans are unsigned`,
        inputSchema: { type: 'object', properties: Object.fromEntries((inputFields[name]?.fields || []).map((field) => [field, properties[field]])),
          ...(inputFields[name]?.required ? { required: inputFields[name].required } : {}) },
      })) },
    });
  }
  if (method === 'tools/call') {
    if (!params || typeof params !== 'object' || Array.isArray(params) ||
        typeof params.name !== 'string' || (params.arguments !== undefined &&
        (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments)))) {
      return res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid tool parameters' } });
    }
    const toolName = String(params?.name || '');
    if (!getAvailableEngines().includes(toolName)) {
      return res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown or unavailable tool' } });
    }
    const receiver = process.env.TREASURY_ADDRESS?.trim();
    if (!receiver) return res.status(503).json({ error: 'TREASURY_ADDRESS is not configured' });
    const amount = Number(process.env.PAYMENT_AMOUNT_SOL?.trim() || DEFAULT_PAYMENT_AMOUNT_SOL);
    const lamports = Math.round(amount * 1_000_000_000);
    return handleX402(req, res, receiver, lamports, async () => {
      const data = await runLiveSolanaEngine(toolName, process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com', params?.arguments || {});
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } };
    });
  }
  return res.status(200).json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Method not found' } });
}
