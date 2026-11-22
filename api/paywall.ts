import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { DEFAULT_PAYMENT_AMOUNT_SOL } from './_lib/pricing.js';
import { notifyPaymentReceived } from './_lib/notify.js';

const NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEFAULT_TREASURY = '2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2';
const USDC_AMOUNT = 10_000_000n;

function verifyProof(wallet: string, signature: string, proof: string): boolean {
  try {
    const bytes = Buffer.from(proof, 'base64');
    if (bytes.length !== 64 || bytes.toString('base64') !== proof) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new PublicKey(wallet).toBuffer()]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(`paywall:${signature}`), key, bytes);
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    return await handlePaywall(req, res);
  } catch (error) {
    console.error('Paywall processing failed', error);
    return res.status(503).json({ error: 'Payment processing unavailable' });
  }
}

async function handlePaywall(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const receiver = process.env.TREASURY_ADDRESS?.trim();
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const paywallSecret = process.env.PAYWALL_SECRET?.trim();
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
  const amountSol = Number(process.env.PAYMENT_AMOUNT_SOL?.trim() || DEFAULT_PAYMENT_AMOUNT_SOL);
  const lamports = Math.round(amountSol * 1_000_000_000);
  if (!Number.isSafeInteger(lamports) || lamports <= 0 || Math.abs(lamports / 1_000_000_000 - amountSol) > 1e-12) {
    return res.status(503).json({ error: 'Invalid PAYMENT_AMOUNT_SOL configuration' });
  }

  let signature = String(req.body?.signature || req.headers['x-payment-signature'] || '').trim();
  const header = req.headers['payment-signature'] || req.headers['x-payment'];
  if (!signature && !header) {
    const payTo = receiver || DEFAULT_TREASURY;
    const accepts = [SOL, USDC].map((asset) => ({
      scheme: 'exact', network: NETWORK, asset, amount: asset === SOL ? String(lamports) : String(USDC_AMOUNT),
      payTo, maxTimeoutSeconds: 300, extra: {},
    }));
    const resource = { url: new URL(req.url || '/api/paywall', process.env.APP_URL?.trim() || `https://${req.headers.host || 'localhost'}`).toString(), mimeType: 'application/json' };
    const challenge = { x402Version: 2, resource, accepts };
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(challenge)).toString('base64'));
    return res.status(402).json({ error: 'Payment Required', ...challenge });
  }
  if (!receiver || !redisUrl || !redisToken || !paywallSecret) {
    return res.status(503).json({ error: 'Treasury, payment store or PAYWALL_SECRET unconfigured' });
  }
  try { new PublicKey(receiver); } catch { return res.status(503).json({ error: 'Invalid treasury address' }); }
  const wallet = String(req.body?.wallet || '').trim();
  const walletProof = String(req.body?.walletProof || '').trim();
  if (Boolean(wallet) !== Boolean(walletProof)) return res.status(403).json({ error: 'Wallet and wallet proof must be provided together' });

  if (!signature && header) {
    let transaction: unknown;
    try {
      const payload = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
      transaction = payload?.payload?.transaction;
    } catch {
      return res.status(400).json({ error: 'Invalid payment header' });
    }
    if (typeof transaction !== 'string') return res.status(400).json({ error: 'Payment transaction is required' });
    const bytes = Buffer.from(transaction, 'base64');
    if (!bytes.length || bytes.length > 1232 || bytes.toString('base64') !== transaction) {
      return res.status(400).json({ error: 'Invalid serialized Solana transaction' });
    }
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [transaction, { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed' }] }),
      });
      const result = await response.json();
      if (!response.ok || result.error || typeof result.result !== 'string') {
        return res.status(503).json({ error: `Solana broadcast failed: ${result.error?.message || response.status}` });
      }
      signature = result.result.trim();
    } catch (error) {
      return res.status(503).json({ error: `Solana broadcast failed: ${error instanceof Error ? error.message : 'network error'}` });
    }
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return res.status(400).json({ error: 'Invalid transaction signature' });

  const hasProof = Boolean(wallet && walletProof);
  if (hasProof && !verifyProof(wallet, signature, walletProof)) {
    return res.status(403).json({ error: 'Invalid wallet proof' });
  }
  const upstash = async (cmd: (string | number)[]) => {
    const r = await fetch(redisUrl, {
      method: 'POST', headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const result = await r.json();
    if (!r.ok || result.error) throw new Error(`Redis request failed: ${result.error || r.status}`);
    return result;
  };

  const rpcRes = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
  });
  const rpcJson = await rpcRes.json();
  if (!rpcRes.ok || rpcJson?.error) return res.status(503).json({ error: `Solana RPC error: ${rpcJson?.error?.message || rpcRes.status}` });
  const tx = rpcJson?.result;
  if (!tx || tx.meta?.err) return res.status(402).json({ error: 'Transaction not confirmed on Solana Mainnet yet', signature });

  const accountKeys = tx.transaction?.message?.accountKeys || [];
  if (hasProof && !accountKeys.some((k: any) => typeof k !== 'string' && k.pubkey === wallet && k.signer === true)) {
    return res.status(403).json({ error: 'Wallet did not sign the payment transaction' });
  }
  const keys = accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  const idx = keys.indexOf(receiver);
  const pre = tx.meta?.preBalances?.[idx];
  const post = tx.meta?.postBalances?.[idx];
  const receivedLamports = Number.isSafeInteger(pre) && Number.isSafeInteger(post) ? BigInt(post) - BigInt(pre) : 0n;
  const instructions = [...(tx.transaction?.message?.instructions || []), ...(tx.meta?.innerInstructions || []).flatMap((entry: any) => entry.instructions || [])];
  const paidLamports = instructions.reduce((sum: bigint, instruction: any) => {
    const info = instruction.parsed?.info;
    if (instruction.program !== 'system' || instruction.parsed?.type !== 'transfer' || info?.destination !== receiver ||
        info?.source === receiver || (hasProof && info?.source !== wallet)) return sum;
    return Number.isSafeInteger(info.lamports) && info.lamports > 0 ? sum + BigInt(info.lamports) : sum;
  }, 0n);
  const tokenBalances = [...(tx.meta?.preTokenBalances || []), ...(tx.meta?.postTokenBalances || [])];
  if (tokenBalances.some((balance: any) => balance.mint === USDC &&
      (typeof balance.owner !== 'string' || typeof balance.uiTokenAmount?.amount !== 'string' || !/^\d+$/.test(balance.uiTokenAmount.amount)))) {
    return res.status(503).json({ error: 'Solana RPC returned incomplete USDC balance data' });
  }
  const tokenTotal = (balances: any[]) => balances.reduce((sum: bigint, balance: any) => {
    const amount = balance.uiTokenAmount?.amount;
    return balance.mint === USDC && balance.owner === receiver && typeof amount === 'string' && /^\d+$/.test(amount)
      ? sum + BigInt(amount) : sum;
  }, 0n);
  const receivedUsdc = tokenTotal(tx.meta?.postTokenBalances || []) - tokenTotal(tx.meta?.preTokenBalances || []);
  const solPaid = receivedLamports >= BigInt(lamports) && paidLamports >= BigInt(lamports);
  if (!solPaid && receivedUsdc < USDC_AMOUNT) {
    return res.status(402).json({ error: `Insufficient payment: need ${lamports} lamports or ${USDC_AMOUNT} USDC atomic units` });
  }

  const apiKey = `sol_live_${crypto.createHmac('sha256', paywallSecret).update(`${signature}:${hasProof ? wallet : ''}`).digest('hex')}`;
  const fingerprint = crypto.createHash('sha256').update(apiKey).digest('hex');
  const issued = await upstash(['EVAL', `
    local existing = redis.call('GET', KEYS[1])
    if existing then
      if ARGV[4] == '1' and existing == ARGV[1] and redis.call('EXISTS', KEYS[2]) == 1 then return 2 end
      return 0
    end
    redis.call('HINCRBYFLOAT', KEYS[3], ARGV[3], ARGV[5])
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SET', KEYS[2], ARGV[2], 'EX', 2592000)
    return 1
  `, 3, `spent_sol_sig:${signature}`, `apikey:${apiKey}`, 'telemetry:stats', fingerprint,
    JSON.stringify({ credits: 10, signature, createdAt: new Date().toISOString() }),
    solPaid ? 'total_sol_earned' : 'total_usdc_earned', hasProof ? '1' : '0', solPaid ? amountSol : Number(USDC_AMOUNT) / 1_000_000]);
  if (issued.result !== 1 && issued.result !== 2) return res.status(409).json({ error: 'Transaction signature already redeemed' });

  const stored = await upstash(['GET', `apikey:${apiKey}`]);
  if (!stored.result) return res.status(500).json({ error: 'Issued API key could not be retrieved' });
  if (issued.result === 1 && solPaid) {
    await notifyPaymentReceived({ amountLamports: lamports, signature, source: '/api/paywall (10-credit pass)', payer: hasProof ? wallet : undefined });
  }
  return res.status(200).json({ success: true, apiKey, credits: JSON.parse(stored.result).credits, asset: solPaid ? 'SOL' : 'USDC', ...(solPaid ? { amountSol, lamports } : { amount: String(USDC_AMOUNT) }) });
}
