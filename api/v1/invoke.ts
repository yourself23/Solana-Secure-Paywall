import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicKey, verify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
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
    const keyObj = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub)]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(`invoke:${wallet}:${ts}`, 'utf8'), keyObj, Buffer.from(sigBytes));
  } catch { return false; }
}

function extractTxSignature(paymentHeader: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    return decoded?.payload?.signature || decoded?.payload?.transaction || decoded?.signature || null;
  } catch {
    return paymentHeader.length >= 64 && paymentHeader.length <= 100 ? paymentHeader : null;
  }
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

  const amountUsdc = parseFloat(process.env.PAYMENT_AMOUNT_USDC || '0.10');
  const units = Math.round(amountUsdc * 1_000_000);
  const lib = ((req.query?.libraryId || req.body?.libraryId || 'solana-sniper-daemon') as string).trim();

  if (!ALLOWED.has(lib)) {
    return res.status(400).json({ error: 'Unsupported libraryId', supportedLibraries: Array.from(ALLOWED) });
  }

  // 1. Native x402 v2 Header Flow (agentcash / autonomous x402 clients)
  const paymentHeader = (req.headers['payment-signature'] || req.headers['x-payment']) as string | undefined;
  if (paymentHeader) {
    const txSig = extractTxSignature(paymentHeader.trim());
    if (!txSig) return res.status(402).json({ error: 'Invalid PAYMENT-SIGNATURE header format' });

    const sigKey = `spent_usdc_sig:${txSig}`;
    const claim = await upstash(['SET', sigKey, 'x402-header', 'EX', 2592000, 'NX']);
    if (claim.result !== 'OK') {
      await logEvent('REPLAY_BLOCKED', `Duplicate x402 header tx ${txSig.slice(0, 8)}...`);
      return res.status(402).json({ error: 'Transaction signature already redeemed' });
    }

    const fallbackRpc = ['https:/', '://solana.com'].join('/');
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || fallbackRpc;
    const rpcRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [txSig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
    });
    const tx = (await rpcRes.json())?.result;
    if (!tx || tx.meta?.err) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({ error: 'Transaction not found or not yet confirmed on-chain' });
    }

    const postEntry = (tx.meta?.postTokenBalances || []).find((b: any) => b.mint === USDC_MINT && b.owner === receiver);
    const preEntry = (tx.meta?.preTokenBalances || []).find((b: any) => b.accountIndex === postEntry?.accountIndex);
    const received = BigInt(postEntry?.uiTokenAmount?.amount || '0') - BigInt(preEntry?.uiTokenAmount?.amount || '0');

    if (received < BigInt(units)) {
      await upstash(['DEL', sigKey]);
      return res.status(402).json({ error: 'Insufficient USDC transfer' });
    }

    await upstash(['HINCRBYFLOAT', 'telemetry:stats', 'total_usdc_earned', amountUsdc]);
    await logEvent('AGENTCASH_PAID', `+${amountUsdc} USDC via x402 header on ${lib}`);
    res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: true, txHash: txSig, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' })).toString('base64'));

    return res.status(200).json({
      success: true,
      libraryId: lib,
      accessMode: 'x402-direct',
      txSignature: txSig,
      data: { status: 'dispatched', engine: lib, network: 'solana-mainnet' },
    });
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
        const decr = await upstash(['HINCRBY', `credits:${wallet}`, bucket, -1]);
        if (Number(decr.result ?? -1) >= 0) {
          await logEvent('INVOKE_PAID', `${wallet.slice(0, 6)}... ran ${lib} (${decr.result} left)`);
          return res.status(200).json({
            success: true,
            libraryId: lib,
            accessMode: 'paid',
            remainingCalls: Number(decr.result),
            data: { status: 'dispatched', engine: lib, network: 'solana-mainnet' },
          });
        }
        await upstash(['HINCRBY', `credits:${wallet}`, bucket, 1]);
      }
    }
  }

  // 3. Issue Standard x402 v2 402 Challenge
  const x402Payload = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      amount: units.toString(),
      asset: USDC_MINT,
      payTo: receiver,
      maxTimeoutSeconds: 300,
      mimeType: 'application/json',
      description: 'Solana Mainnet MEV, Jito Bundle, and Sniper Execution Gateway',
    }],
  })).toString('base64');

  await logEvent('CRAWLER_PROBE_402', `Served x402 v2 quote on ${lib}`);
  res.setHeader('PAYMENT-REQUIRED', x402Payload);
  res.setHeader('X-Payment-Required', 'true');
  res.setHeader('X-Payment-Amount', units.toString());
  res.setHeader('X-Payment-Recipient', receiver);
  res.setHeader('X-Payment-Network', 'solana-mainnet');
  res.setHeader('X-Payment-Asset', 'USDC');
  res.setHeader('X-Payment-Mint', USDC_MINT);

  return res.status(402).json({
    error: 'Payment Required',
    x402Version: 2,
    network: 'solana-mainnet',
    asset: 'USDC',
    mint: USDC_MINT,
    depositAddress: receiver,
    amountBaseUnits: units,
    amountUsdc,
  });
}
