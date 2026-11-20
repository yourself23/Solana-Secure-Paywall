import { handleX402 } from "../_lib/x402-settle.js";
import { DEFAULT_PAYMENT_AMOUNT_SOL } from "../_lib/pricing.js";
import { AVAILABLE_ENGINES, getAvailableEngines, runLiveSolanaEngine } from "../_lib/engines.js";
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicKey, verify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALLOWED = new Set([
  "solana-sniper-daemon",
  "mev-arbitrage-bot",
  "jito-bundle-dispatcher",
  "liquidity-pool-sniffer",
  "raydium-swap-automator",
  "pump-fun-bonding-curve",
  "whale-wallet-tracker",
  "flash-loan-arbitrage",
  "multi-wallet-jito-injector",
  "limit-order-sniper",
  "cross-dex-router",
  "mempool-alpha-scanner",
  "rug-pull-mint-auditor",
  "holder-concentration-analyzer",
  "priority-fee-oracle",
  "token-boost-radar",
  "smart-money-copy-scanner",
  "orca-whirlpool-scanner",
  "meteora-dlmm-yield-finder",
  "solana-tps-health-monitor",
  "validator-stake-tracker",
  "spl-token-metadata-resolver",
  "dex-volume-surge-detector",
  "sol-usdc-spread-scanner"
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
    const keyObj = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub)]),
      format: 'der',
      type: 'spki',
    });
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
    const result = await r.json();
    if (!r.ok || result.error) throw new Error(`Redis request failed: ${result.error || r.status}`);
    return result;
  };

  const logEvent = async (type: string, detail: string) => {
    const entry = JSON.stringify({ ts: new Date().toISOString(), type, detail });
    await upstash(['LPUSH', 'telemetry:events', entry]).catch(() => {});
    await upstash(['LTRIM', 'telemetry:events', 0, 99]).catch(() => {});
    await upstash(['HINCRBY', 'telemetry:stats', type, 1]).catch(() => {});
  };

  const amountSol = parseFloat(process.env.PAYMENT_AMOUNT_SOL || DEFAULT_PAYMENT_AMOUNT_SOL);
  const units = Math.round(amountSol * 1_000_000_000);
  const lib = ((req.query?.libraryId || req.body?.libraryId || 'whale-wallet-tracker') as string).trim();

  if (!ALLOWED.has(lib)) {
    return res.status(400).json({ error: 'Unsupported libraryId', supportedLibraries: getAvailableEngines() });
  }
  if (!(AVAILABLE_ENGINES as readonly string[]).includes(lib)) {
    return res.status(501).json({ error: 'Engine is not implemented and cannot be purchased', availableLibraries: getAvailableEngines() });
  }
  if (!getAvailableEngines().includes(lib)) {
    return res.status(503).json({ error: 'Engine is not configured', availableLibraries: getAvailableEngines() });
  }

  const apiKey = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (apiKey) {
    const key = `apikey:${apiKey}`;
    const available = await upstash(['GET', key]);
    if (!available.result) return res.status(401).json({ error: 'Invalid or expired API key' });
    const record = JSON.parse(available.result);
    if (!Number.isInteger(record.credits) || record.credits < 1) {
      return res.status(402).json({ error: 'Prepaid API key has no remaining credits' });
    }

    const data = await runLiveSolanaEngine(lib, process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com', { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) });
    const debit = await upstash(['EVAL', `
      local value = redis.call('GET', KEYS[1])
      if not value then return -1 end
      local record = cjson.decode(value)
      if not record.credits or record.credits < 1 then return -1 end
      record.credits = record.credits - 1
      redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
      return record.credits
    `, 1, key]);
    if (!Number.isInteger(debit.result) || debit.result < 0) {
      return res.status(402).json({ error: 'Prepaid API key has no remaining credits' });
    }
    return res.status(200).json({ success: true, libraryId: lib, accessMode: 'prepaid', remainingCalls: debit.result, data });
  }

  // 2. Prepaid Credit + Ed25519 Header Flow
  const wallet = (req.headers['x-wallet-address'] as string)?.trim();
  const ts = (req.headers['x-auth-timestamp'] as string)?.trim();
  const sig = (req.headers['x-auth-signature'] as string)?.trim();

  if (wallet && ts && sig) {
    if (!verifySig(wallet, ts, sig)) {
      await logEvent('AUTH_FAILED', `Bad sig from ${wallet.slice(0, 6)}...`);
      return res.status(403).json({ error: 'Invalid or expired Solana wallet signature' });
    }
    for (const bucket of [lib, 'default']) {
      const check = await upstash(['HGET', `credits:${wallet}`, bucket]);
      if (Number(check.result ?? 0) > 0) {
        const data = await runLiveSolanaEngine(lib, process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com', { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) });
        const decr = await upstash(['HINCRBY', `credits:${wallet}`, bucket, -1]);
        if (Number(decr.result ?? -1) >= 0) {
          await logEvent('INVOKE_PAID', `${wallet.slice(0, 6)}... ran ${lib} (${decr.result} left)`);
          return res.status(200).json({
            success: true,
            libraryId: lib,
            accessMode: 'paid',
            remainingCalls: Number(decr.result),
            data,
          });
        }
        await upstash(['HINCRBY', `credits:${wallet}`, bucket, 1]);
      }
    }
  }

  return handleX402(req, res, receiver, units, async () => {
    const data = await runLiveSolanaEngine(lib, process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com', { ...(req.query || {}), ...(typeof req.body === 'object' && req.body ? req.body : {}) });
    return { libraryId: lib, accessMode: 'x402-direct', data };
  });
}
