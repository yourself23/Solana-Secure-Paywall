import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  if (!receiver) {
    return res.status(500).json({ error: 'Server configuration incomplete: TREASURY_ADDRESS missing' });
  }

  const amountSol = parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1');
  const requiredLamports = Math.round(amountSol * 1_000_000_000);
  const callsPerPayment = Number(process.env.API_CALLS_PER_PAYMENT || '60');

  if (req.method !== 'POST') {
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', requiredLamports.toString());
    res.setHeader('X-Payment-Recipient', receiver);
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'SOL');
    return res.status(402).json({
      error: 'Payment Required',
      network: 'solana-mainnet',
      asset: 'SOL',
      depositAddress: receiver,
      amountLamports: requiredLamports,
      amountSol,
    });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!redisUrl || !redisToken) {
    return res.status(500).json({ error: 'Server configuration incomplete: Upstash Redis credentials missing' });
  }

  const upstash = async (cmd: (string | number)[]) => {
    const r = await fetch(redisUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
    });
    if (!r.ok) throw new Error(`Upstash HTTP ${r.status}`);
    return r.json();
  };

  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : (forwarded?.split(',')[0]?.trim() || 'anonymous');
  const rateKey = `rl:paywall:${ip}:${Math.floor(Date.now() / 60000)}`;
  const rlRes = await upstash(['INCR', rateKey]);
  if (rlRes.result === 1) await upstash(['EXPIRE', rateKey, 60]);
  if (Number(rlRes.result) > 30) {
    return res.status(429).json({ error: 'Too many requests. Please wait before retrying.' });
  }

  const { signature, wallet, libraryId = 'default' } = req.body || {};
  if (
    typeof signature !== 'string' || signature.length < 64 || signature.length > 100 ||
    typeof wallet !== 'string' || wallet.length < 32 || wallet.length > 44 ||
    typeof libraryId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(libraryId)
  ) {
    return res.status(400).json({ error: 'Invalid signature, wallet, or libraryId' });
  }

  const sigKey = `spent_sol_sig:${signature}`;
  const claimRes = await upstash(['SET', sigKey, wallet, 'EX', 86400 * 30, 'NX']);
  if (claimRes.result !== 'OK') {
    return res.status(402).json({ error: 'Transaction signature already redeemed' });
  }

  try {
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://solana.com';
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

    const rpcData = await rpcRes.json();
    const tx = rpcData?.result;

    if (!tx) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({ error: 'Transaction not found or not yet confirmed on-chain' });
    }

    if (tx.meta?.err) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({ error: 'Transaction failed on-chain' });
    }

    const accountKeys = tx.transaction?.message?.accountKeys || [];
    const signer = accountKeys.find((k: any) => k.signer)?.pubkey;
    if (signer !== wallet) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({ error: 'Transaction signer does not match requesting wallet' });
    }

    const receiverIdx = accountKeys.findIndex((k: any) => k.pubkey === receiver);
    if (receiverIdx === -1) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({ error: 'Paywall recipient not found in transaction' });
    }

    const receivedLamports = (tx.meta.postBalances?.[receiverIdx] ?? 0) - (tx.meta.preBalances?.[receiverIdx] ?? 0);
    if (receivedLamports < requiredLamports) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({
        error: `Insufficient SOL transfer: received ${receivedLamports} lamports, expected ${requiredLamports}`,
      });
    }

    const creditRes = await upstash(['HINCRBY', `credits:${wallet}`, libraryId, callsPerPayment]);

    return res.status(200).json({
      success: true,
      message: 'Paywall access granted',
      depositAddress: receiver,
      credits: creditRes.result,
      amount: amountSol,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    await upstash(['DEL', sigKey]);
    return res.status(503).json({
      error: 'Solana RPC verification unavailable',
      details: err?.message || 'Unknown RPC error',
    });
  }
}
