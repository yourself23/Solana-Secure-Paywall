import type { VercelRequest, VercelResponse } from '@vercel/node';

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  if (!receiver) {
    return res.status(500).json({ error: 'Server configuration incomplete: TREASURY_ADDRESS missing' });
  }

  const amountUsdc = parseFloat(process.env.PAYMENT_AMOUNT_USDC || '10');
  const requiredBaseUnits = Math.round(amountUsdc * 1_000_000);
  const callsPerPayment = Number(process.env.API_CALLS_PER_PAYMENT || '60');

  if (req.method !== 'POST') {
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', requiredBaseUnits.toString());
    res.setHeader('X-Payment-Recipient', receiver);
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'USDC');
    res.setHeader('X-Payment-Mint', SOLANA_USDC_MINT);
    return res.status(402).json({
      error: 'Payment Required',
      network: 'solana-mainnet',
      asset: 'USDC',
      mint: SOLANA_USDC_MINT,
      depositAddress: receiver,
      amountBaseUnits: requiredBaseUnits,
      amountUsdc,
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
  const ip = Array.isArray(forwarded) ? forwarded : (forwarded?.split(',')?.trim() || 'anonymous');
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

  const sigKey = `spent_usdc_sig:${signature}`;
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

    const preTokens = tx.meta?.preTokenBalances || [];
    const postTokens = tx.meta?.postTokenBalances || [];

    const postEntry = postTokens.find(
      (b: any) => b.mint === SOLANA_USDC_MINT && b.owner === receiver
    );

    if (!postEntry) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({ error: 'No USDC token balance found for paywall recipient' });
    }

    const preEntry = preTokens.find(
      (b: any) => b.accountIndex === postEntry.accountIndex && b.mint === SOLANA_USDC_MINT
    );

    const postUnits = BigInt(postEntry.uiTokenAmount?.amount || '0');
    const preUnits = BigInt(preEntry?.uiTokenAmount?.amount || '0');
    const receivedUnits = postUnits - preUnits;

    if (receivedUnits < BigInt(requiredBaseUnits)) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({
        error: `Insufficient USDC transfer: received ${receivedUnits.toString()} base units, expected ${requiredBaseUnits}`,
      });
    }

    const creditRes = await upstash(['HINCRBY', `credits:${wallet}`, libraryId, callsPerPayment]);

    return res.status(200).json({
      success: true,
      message: 'Solana USDC payment verified and credits granted',
      asset: 'USDC',
      depositAddress: receiver,
      credits: creditRes.result,
      amountUsdc,
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
