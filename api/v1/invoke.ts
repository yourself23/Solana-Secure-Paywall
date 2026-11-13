import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicKey, verify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALLOWED = new Set([
  'solana-sniper-daemon', 'mev-arbitrage-bot', 'jito-bundle-dispatcher',
  'liquidity-pool-sniffer', 'raydium-swap-automator', 'pump-fun-bonding-curve',
  'whale-wallet-tracker', 'flash-loan-arbitrage', 'multi-wallet-jito-injector',
  'limit-order-sniper', 'cross-dex-router', 'mempool-alpha-scanner',
]);

function decodeBase58(input: string): Uint8Array {
  const bytes = new Array<number>();
  for (let i = 0; i < input.length; i++) {
    const val = ALPHABET.indexOf(input[i]!);
    if (val < 0) throw new Error('Invalid base58');
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < input.length && input[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function verifySig(wallet: string, ts: string, sig: string): boolean {
  try {
    if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() - Number(ts)) > 60_000) return false;
    const pub = decodeBase58(wallet);
    const sigBytes = decodeBase58(sig);
    if (pub.length !== 32 || sigBytes.length !== 64) return false;
    const keyObj = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub)]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(`invoke:${wallet}:${ts}`, 'utf8'), keyObj, Buffer.from(sigBytes));
  } catch { return false; }
}

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

  const wallet = (req.headers['x-wallet-address'] as string)?.trim();
  const ts = (req.headers['x-auth-timestamp'] as string)?.trim();
  const sig = (req.headers['x-auth-signature'] as string)?.trim();
  const lib = ((req.query?.libraryId || req.body?.libraryId) as string)?.trim();

  if (!wallet || !ts || !sig || !lib) return res.status(401).json({ error: 'Missing auth headers or libraryId' });
  if (!ALLOWED.has(lib)) return res.status(400).json({ error: 'Unsupported libraryId' });
  if (!verifySig(wallet, ts, sig)) {
    await logEvent('AUTH_FAILED', `Bad sig from ${wallet.slice(0, 6)}...`);
    return res.status(403).json({ error: 'Invalid wallet signature' });
  }

  let mode: 'paid' | 'trial' | 'none' = 'none';
  let remaining = 0;

  for (const bucket of [lib, 'default']) {
    const check = await upstash(['HGET', `credits:${wallet}`, bucket]);
    if (Number(check.result ?? 0) > 0) {
      const decr = await upstash(['HINCRBY', `credits:${wallet}`, bucket, -1]);
      if (Number(decr.result ?? -1) >= 0) { mode = 'paid'; remaining = Number(decr.result); break; }
      await upstash(['HINCRBY', `credits:${wallet}`, bucket, 1]);
    }
  }

    if (mode === 'none') {
    const amountUsdc = parseFloat(process.env.PAYMENT_AMOUNT_USDC || '10');
    const units = Math.round(amountUsdc * 1_000_000);
    await logEvent('INVOKE_402', `Paywall hit by ${wallet.slice(0, 6)}... on ${lib}`);
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', units.toString());
    res.setHeader('X-Payment-Recipient', receiver);
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'USDC');
    return res.status(402).json({ error: 'Payment Required', asset: 'USDC', depositAddress: receiver, amountBaseUnits: units, amountUsdc });
  }

  await logEvent(`INVOKE_${mode.toUpperCase()}`, `${wallet.slice(0, 6)}... ran ${lib} (${remaining} left)`);
  return res.status(200).json({ success: true, libraryId: lib, accessMode: mode, remainingCalls: remaining, data: { status: 'dispatched', engine: lib } });
}
