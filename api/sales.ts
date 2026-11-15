import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Public, read-only feed of real USDC deposits received by the treasury.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  if (!receiver) return res.status(500).json({ error: 'Config missing' });
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';

  const rpc = async (method: string, params: unknown[]) => {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await r.json();
    if (body?.error) throw new Error(body.error.message || 'RPC error');
    return body.result;
  };

  try {
    const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(receiver), true).toBase58();
    const sigs: any[] = (await rpc('getSignaturesForAddress', [ata, { limit: 15 }])) || [];
    const txs = await Promise.all(
      sigs
        .filter((s) => !s.err)
        .map((s) =>
          rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }])
            .then((tx) => ({ s, tx }))
            .catch(() => ({ s, tx: null })),
        ),
    );

    const sales = txs.flatMap(({ s, tx }) => {
      const pre: any[] = tx?.meta?.preTokenBalances || [];
      const post: any[] = tx?.meta?.postTokenBalances || [];
      const after = post.find((b) => b.mint === USDC_MINT && b.owner === receiver);
      if (!after) return [];
      const before = pre.find((b) => b.accountIndex === after.accountIndex);
      const units = BigInt(after.uiTokenAmount?.amount || '0') - BigInt(before?.uiTokenAmount?.amount || '0');
      if (units <= 0n) return [];
      const sender = pre.find(
        (b) => b.mint === USDC_MINT && b.owner !== receiver &&
          BigInt(b.uiTokenAmount?.amount || '0') > BigInt(post.find((p) => p.accountIndex === b.accountIndex)?.uiTokenAmount?.amount || '0'),
      )?.owner;
      return [{
        signature: s.signature,
        blockTime: s.blockTime,
        slot: s.slot,
        sender: sender || null,
        amountUsdc: Number(units) / 1_000_000,
      }];
    });

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.status(200).json({
      treasury: receiver,
      sales,
      totalUsdc: sales.reduce((a, x) => a + x.amountUsdc, 0),
      callsPerPayment: Number(process.env.API_CALLS_PER_PAYMENT || '10'),
    });
  } catch (err: any) {
    return res.status(503).json({ error: 'RPC error', details: err?.message });
  }
}
