import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const receiver = process.env.TREASURY_ADDRESS?.trim() || '2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2';
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const fallbackRpc = ['https:/', '://solana.com'].join('/');
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || fallbackRpc;

  const signature = String(req.body?.signature || '').trim();
  if (!signature || signature.length < 64) {
    return res.status(400).json({ error: 'Valid Solana transaction signature required (0.001 SOL / 1,000,000 lamports)' });
  }
  if (!redisUrl || !redisToken) {
    return res.status(500).json({ error: 'Redis store unconfigured' });
  }

  const upstash = async (cmd: (string | number)[]) => {
    const r = await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return r.json();
  };

  const sigKey = `spent_sol_sig:${signature}`;
  const claim = await upstash(['SET', sigKey, 'prepaid-pass', 'EX', 2592000, 'NX']);
  if (claim.result !== 'OK') {
    return res.status(409).json({ error: 'Transaction signature already redeemed' });
  }

  const rpcRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
    }),
  });
  const rpcJson = await rpcRes.json();
  const tx = rpcJson?.result;

  if (!tx || tx.meta?.err) {
    await upstash(['DEL', sigKey]);
    return res.status(402).json({ error: 'Transaction not confirmed on Solana Mainnet yet' });
  }

  const keys = (tx.transaction?.message?.accountKeys || []).map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  const idx = keys.indexOf(receiver);
  const receivedLamports = idx >= 0 ? BigInt(tx.meta.postBalances[idx] || 0) - BigInt(tx.meta.preBalances[idx] || 0) : 0n;

  if (receivedLamports < 1_000_000n) {
    await upstash(['DEL', sigKey]);
    return res.status(402).json({ error: `Insufficient Native SOL transfer (received ${receivedLamports} lamports, need 1,000,000)` });
  }

  const apiKey = `sol_live_${crypto.randomBytes(18).toString('hex')}`;
  await upstash(['SET', `apikey:${apiKey}`, JSON.stringify({ credits: 10, signature, createdAt: new Date().toISOString() }), 'EX', 2592000]);
  await upstash(['HINCRBYFLOAT', 'telemetry:stats', 'total_usdc_earned', 0.001]);

  return res.status(200).json({ success: true, apiKey, credits: 10, asset: 'SOL', lamports: 1000000 });
}
