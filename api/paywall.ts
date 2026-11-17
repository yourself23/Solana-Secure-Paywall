import type { VercelRequest, VercelResponse } from '@vercel/node';

const USDC_MINT = 'So11111111111111111111111111111111111111112';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!receiver || !redisUrl || !redisToken) return res.status(500).json({ error: 'Config missing' });

  const upstash = async (cmd: (string | number)[]) => {
    const r = await fetch(redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return r.json();
  };

  const logEvent = async (type: string, detail: string) => {
    const entry = JSON.stringify({ ts: new Date().toISOString(), type, detail });
    await upstash(['LPUSH', 'telemetry:events', entry]).catch(() => {});
    await upstash(['LTRIM', 'telemetry:events', 0, 99]).catch(() => {});
    await upstash(['HINCRBY', 'telemetry:stats', type, 1]).catch(() => {});
  };

  const amountUsdc = parseFloat(process.env.PAYMENT_AMOUNT_USDC || '0.1');
  const requiredUnits = Math.round(amountUsdc * 1_000_000);
  const calls = Number(process.env.API_CALLS_PER_PAYMENT || '10');

  if (req.method !== 'POST') {
    await logEvent('402_CHALLENGE', `Quoted ${amountUsdc} USDC`);
    
    const x402Payload = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepts: [{
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: requiredUnits.toString(),
        asset: "So11111111111111111111111111111111111111112",
        payTo: receiver,
        maxTimeoutSeconds: 300
      }]
    })).toString("base64");
    res.setHeader("PAYMENT-REQUIRED", x402Payload);

    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', requiredUnits.toString());
    res.setHeader('X-Payment-Recipient', receiver);
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'SOL');
    res.setHeader('X-Payment-Mint', USDC_MINT);
    return res.status(402).json({ error: 'Payment Required', asset: 'SOL', mint: USDC_MINT, depositAddress: receiver, amountBaseUnits: requiredUnits, amountUsdc });
  }

  const { signature, wallet, libraryId = 'default' } = req.body || {};
  if (typeof signature !== 'string' || signature.length < 64 || typeof wallet !== 'string' || wallet.length < 32) {
    return res.status(400).json({ error: 'Invalid signature or wallet' });
  }

  const sigKey = `spent_usdc_sig:${signature}`;
  const claim = await upstash(['SET', sigKey, wallet, 'EX', 2592000, 'NX']);
  if (claim.error) return res.status(503).json({ error: 'Redis error', details: claim.error });
  if (claim.result !== 'OK') {
    await logEvent('REPLAY_BLOCKED', `Duplicate tx by ${wallet.slice(0, 6)}...`);
    return res.status(402).json({ error: 'Transaction already redeemed' });
  }

  try {
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
    // The RPC node may lag behind the client's confirmation, so retry before rejecting.
    let tx: any = null;
    for (let i = 0; i < 5 && !tx; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const rpcRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
      });
      const body = await rpcRes.json();
      if (body?.error) throw new Error(`RPC: ${body.error.message || JSON.stringify(body.error)}`);
      tx = body?.result;
    }
    if (!tx || tx.meta?.err) {
      await upstash(['DEL', sigKey]);
      await logEvent('UNCONFIRMED_TX', `Failed tx ${signature.slice(0, 8)}...`);
      return res.status(402).json({ error: 'Transaction not found or failed' });
    }

    const postEntry = (tx.meta?.postTokenBalances || []).find((b: any) => b.mint === USDC_MINT && b.owner === receiver);
    const preEntry = (tx.meta?.preTokenBalances || []).find((b: any) => b.accountIndex === postEntry?.accountIndex);
    const received = BigInt(postEntry?.uiTokenAmount?.amount || '0') - BigInt(preEntry?.uiTokenAmount?.amount || '0');

    if (received < BigInt(requiredUnits)) {
      await upstash(['DEL', sigKey]);
      await logEvent('UNDERPAYMENT', `Got ${received} units, needed ${requiredUnits}`);
      return res.status(402).json({ error: 'Insufficient USDC transfer' });
    }

    const creditRes = await upstash(['HINCRBY', `credits:${wallet}`, libraryId, calls]);
    await upstash(['HINCRBYFLOAT', 'telemetry:stats', 'total_usdc_earned', amountUsdc]);
    await logEvent('PAYMENT_VERIFIED', `+${amountUsdc} USDC from ${wallet.slice(0, 6)}...`);

    return res.status(200).json({ success: true, credits: creditRes.result, amountUsdc });
  } catch (err: any) {
    await upstash(['DEL', sigKey]);
    return res.status(503).json({ error: 'RPC error', details: err?.message });
  }
}
