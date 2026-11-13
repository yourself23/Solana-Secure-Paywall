import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicKey, verify } from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_SIGNATURE_AGE_MS = 60_000;
const MAX_TRIAL_CALLS = 2;

const ALLOWED_LIBRARIES = new Set([
  'solana-sniper-daemon',
  'mev-arbitrage-bot',
  'jito-bundle-dispatcher',
  'liquidity-pool-sniffer',
  'raydium-swap-automator',
  'pump-fun-bonding-curve',
  'whale-wallet-tracker',
  'flash-loan-arbitrage',
  'multi-wallet-jito-injector',
  'limit-order-sniper',
  'cross-dex-router',
  'mempool-alpha-scanner',
]);

function decodeBase58(input: string): Uint8Array {
  if (!input || typeof input !== 'string') throw new Error('Empty base58 input');
  const bytes =;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    const val = BASE58_ALPHABET.indexOf(c);
    if (val < 0) throw new Error('Invalid base58 character');
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < input.length && input[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function verifySolanaSignature(wallet: string, timestamp: string, signatureBase58: string): boolean {
  try {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SIGNATURE_AGE_MS) {
      return false;
    }
    const pubkeyBytes = decodeBase58(wallet);
    const sigBytes = decodeBase58(signatureBase58);
    if (pubkeyBytes.length !== 32 || sigBytes.length !== 64) {
      return false;
    }

    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const keyObject = createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(pubkeyBytes)]),
      format: 'der',
      type: 'spki',
    });

    const message = Buffer.from(`invoke:${wallet}:${timestamp}`, 'utf8');
    return verify(null, message, keyObject, Buffer.from(sigBytes));
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const receiver = process.env.TREASURY_ADDRESS?.trim();
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!receiver || !redisUrl || !redisToken) {
    return res.status(500).json({ error: 'Server configuration incomplete' });
  }

  const wallet = (req.headers['x-wallet-address'] as string)?.trim();
  const timestamp = (req.headers['x-auth-timestamp'] as string)?.trim();
  const signature = (req.headers['x-auth-signature'] as string)?.trim();
  const libraryId = ((req.query?.libraryId || req.body?.libraryId) as string)?.trim();

  if (!wallet || !timestamp || !signature || !libraryId) {
    return res.status(401).json({
      error: 'Missing authentication headers (x-wallet-address, x-auth-timestamp, x-auth-signature) or libraryId',
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(libraryId) || !ALLOWED_LIBRARIES.has(libraryId)) {
    return res.status(400).json({
      error: 'Invalid or unsupported libraryId',
      supportedLibraries: Array.from(ALLOWED_LIBRARIES),
    });
  }

  if (!verifySolanaSignature(wallet, timestamp, signature)) {
    return res.status(403).json({ error: 'Invalid or expired Solana wallet signature' });
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

  let accessMode: 'paid' | 'trial' | 'none' = 'none';
  let remainingCalls = 0;

  const creditCheck = await upstash(['HGET', `credits:${wallet}`, libraryId]);
  const currentCredits = Number(creditCheck.result ?? 0);

  if (currentCredits > 0) {
    const decrRes = await upstash(['HINCRBY', `credits:${wallet}`, libraryId, -1]);
    const updated = Number(decrRes.result ?? -1);
    if (updated >= 0) {
      accessMode = 'paid';
      remainingCalls = updated;
    } else {
      await upstash(['HINCRBY', `credits:${wallet}`, libraryId, 1]);
    }
  }

  if (accessMode === 'none') {
    const trialRes = await upstash(['INCR', `trials:${wallet}`]);
    const trialsUsed = Number(trialRes.result ?? 999);
    if (trialsUsed <= MAX_TRIAL_CALLS) {
      accessMode = 'trial';
      remainingCalls = MAX_TRIAL_CALLS - trialsUsed;
    } else {
      await upstash(['DECR', `trials:${wallet}`]);
    }
  }

  if (accessMode === 'none') {
    const amountSol = parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1');
    const amountLamports = Math.round(amountSol * 1_000_000_000);

    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', amountLamports.toString());
    res.setHeader('X-Payment-Recipient', receiver);
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'SOL');

    return res.status(402).json({
      error: 'Payment Required',
      message: 'Free trial calls exhausted. Send SOL to depositAddress and POST the signature to /api/paywall.',
      network: 'solana-mainnet',
      asset: 'SOL',
      depositAddress: receiver,
      amountLamports,
      amountSol,
      trialCallsRemaining: 0,
    });
  }

  try {
    const mod = await import(`../libraries/${libraryId}.js`).catch(() => import(`../libraries/${libraryId}`));
    const execute = mod.default || mod.run;
    const result = typeof execute === 'function' ? await execute(req.body || req.query) : { status: 'executed', libraryId };

    return res.status(200).json({
      success: true,
      libraryId,
      accessMode,
      remainingCalls,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(200).json({
      success: true,
      libraryId,
      accessMode,
      remainingCalls,
      data: { status: 'dispatched', engine: libraryId, network: 'solana-mainnet' },
      timestamp: new Date().toISOString(),
    });
  }
}
