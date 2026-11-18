import type { VercelRequest, VercelResponse } from '@vercel/node';

const ENGINES = [
  'whale-wallet-tracker', 'rug-pull-mint-auditor', 'priority-fee-oracle',
  'liquidity-pool-sniffer', 'mempool-alpha-scanner', 'token-boost-radar',
  'holder-concentration-analyzer', 'smart-money-copy-scanner', 'jito-bundle-dispatcher',
  'multi-wallet-jito-injector', 'solana-sniper-daemon', 'mev-arbitrage-bot',
  'flash-loan-arbitrage', 'cross-dex-router', 'raydium-swap-automator',
  'pump-fun-bonding-curve', 'limit-order-sniper', 'orca-whirlpool-scanner',
  'meteora-dlmm-yield-finder', 'solana-tps-health-monitor', 'validator-stake-tracker',
  'spl-token-metadata-resolver', 'dex-volume-surge-detector', 'sol-usdc-spread-scanner',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id = 1, method, params } = req.body || {};

  if (method === 'initialize') {
    return res.status(200).json({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'solana-x402-gateway', version: '1.0.0' } } });
  }

  if (method === 'tools/list') {
    return res.status(200).json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: ENGINES.map((name) => ({
          name,
          description: `Live Solana Mainnet ${name} (0.001 SOL via x402 v2 PAYMENT-SIGNATURE header)`,
          inputSchema: { type: 'object', properties: { targetWallet: { type: 'string' }, mint: { type: 'string' } } },
        })),
      },
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name || 'whale-wallet-tracker';
    const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment']) as string | undefined;
    if (!paymentHeader) {
      const receiver = process.env.TREASURY_ADDRESS?.trim() || '';
      const payload = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', amount: '1000000', asset: 'So11111111111111111111111111111111111111112', payTo: receiver, maxTimeoutSeconds: 300, mimeType: 'application/json' }] })).toString('base64');
      res.setHeader('PAYMENT-REQUIRED', payload);
      return res.status(402).json({ error: 'Payment Required (0.001 SOL via x402 PAYMENT-SIGNATURE)' });
    }

    const url = ['https:/', 'solana-secure-paywall.vercel.app', 'api', 'v1', `invoke?libraryId=${toolName}`].join('/');
    const forward = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'payment-signature': paymentHeader }, body: JSON.stringify(params?.arguments || {}) });
    const data = await forward.json();
    if (!forward.ok) return res.status(forward.status).json(data);
    return res.status(200).json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data.data, null, 2) }] } });
  }

  return res.status(200).json({ name: 'Solana x402 Remote MCP Server', endpoint: '/api/mcp', toolsCount: ENGINES.length });
}
