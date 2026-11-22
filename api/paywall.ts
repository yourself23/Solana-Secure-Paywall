import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { DEFAULT_PAYMENT_AMOUNT_SOL } from './_lib/pricing.js';
import { notifyPaymentReceived } from './_lib/notify.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const receiver = process.env.TREASURY_ADDRESS?.trim();
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const paywallSecret = process.env.PAYWALL_SECRET?.trim();
  const fallbackRpc = 'https://api.mainnet-beta.solana.com';
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || fallbackRpc;

  let signature = String(req.body?.signature || req.headers["x-payment-signature"] || "").trim(); const xpay = String(req.headers["x-payment"] || req.headers["payment-signature"] || "").trim(); if (!signature && xpay) { try { const o = JSON.parse(xpay.startsWith("eyJ") ? Buffer.from(xpay, "base64").toString("utf8") : xpay); const rawTx = o?.payload?.transaction || o?.transaction; if (rawTx && rawTx.length > 80) { const sr = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [rawTx, { encoding: "base64", preflightCommitment: "confirmed" }] }) }); const sj = await sr.json(); signature = String(sj?.result || "").trim(); } else { signature = String(o?.payload?.signature || o?.signature || "").trim(); } } catch {} }
  if (!signature || signature.length < 64) {
    return res.status(402).json({ x402Version: 2, error: "Payment Required (x402 Native SOL or USDC)", accepts: [{ scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "So11111111111111111111111111111111111111112", maxAmountRequired: "100000000", payTo: "2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2" }, { scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", maxAmountRequired: "10000000", payTo: "2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2" }], treasury: "2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2" });
  }
  if (!receiver || !redisUrl || !redisToken || !paywallSecret) {
    return res.status(500).json({ error: 'Treasury, payment store or PAYWALL_SECRET unconfigured' });
  }
  const wallet = String(req.body?.wallet || '').trim();
  const walletProof = String(req.body?.walletProof || '').trim();
  const hasProof = Boolean(wallet && walletProof);
  const amountSol = Number(process.env.PAYMENT_AMOUNT_SOL || DEFAULT_PAYMENT_AMOUNT_SOL);
  const lamports = Math.round(amountSol * 1_000_000_000);
  if (!Number.isSafeInteger(lamports) || lamports <= 0 || Math.abs(lamports / 1_000_000_000 - amountSol) > 1e-12) {
    return res.status(500).json({ error: 'Invalid PAYMENT_AMOUNT_SOL configuration' });
  }

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

  const sigKey = `spent_sol_sig:${signature}`;
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
  if (!rpcRes.ok || rpcJson?.error) {
    return res.status(503).json({ error: `Solana RPC error: ${rpcJson?.error?.message || rpcRes.status}` });
  }
  const tx = rpcJson?.result;

  if (!tx || tx.meta?.err) {
    return res.status(402).json({ error: 'Transaction not confirmed on Solana Mainnet yet' });
  }

  const accountKeys = tx.transaction?.message?.accountKeys || [];
  if (hasProof && !accountKeys.some((k: any) => typeof k !== 'string' && k.pubkey === wallet && k.signer === true)) {
    return res.status(403).json({ error: 'Wallet did not sign the payment transaction' });
  }
  const keys = accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  const idx = keys.indexOf(receiver);
  const receivedLamports = idx >= 0 ? BigInt(tx.meta.postBalances[idx] || 0) - BigInt(tx.meta.preBalances[idx] || 0) : 0n;
  const requiredLamports = BigInt(lamports);
  const instructions = tx.transaction?.message?.instructions || [];
  const paidLamports = instructions.reduce((sum: bigint, instruction: any) => {
    const info = instruction.parsed?.info;
    if (instruction.program !== 'system' || instruction.parsed?.type !== 'transfer' || info?.source !== wallet || info?.destination !== receiver) return sum;
    const amount = info.lamports;
    return Number.isSafeInteger(amount) && amount > 0 ? sum + BigInt(amount) : sum;
  }, 0n);

  const usdcOk = (tx.meta?.postTokenBalances || []).some((b: any) => b.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" && b.owner === receiver && Number(b.uiTokenAmount?.amount || 0) >= 10000000); if (receivedLamports < requiredLamports && !usdcOk) {
    return res.status(402).json({ error: `Insufficient native SOL transfer from the signing wallet (need ${requiredLamports} lamports)` });
  }

  const apiKey = `sol_live_${crypto.createHmac('sha256', paywallSecret).update(`${signature}:${wallet}`).digest('hex')}`;
  const fingerprint = crypto.createHash('sha256').update(apiKey).digest('hex');
  const issued = await upstash(['EVAL', `
    local existing = redis.call('GET', KEYS[1])
    if existing then
      if existing == ARGV[1] and redis.call('EXISTS', KEYS[2]) == 1 then return 2 end
      return 0
    end
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('SET', KEYS[2], ARGV[2], 'EX', 2592000)
    redis.call('HINCRBYFLOAT', KEYS[3], 'total_sol_earned', ARGV[3])
    return 1
  `, 3, sigKey, `apikey:${apiKey}`, 'telemetry:stats', fingerprint, JSON.stringify({ credits: 10, signature, createdAt: new Date().toISOString() }), amountSol]);
  if (issued.result !== 1 && issued.result !== 2) {
    return res.status(409).json({ error: 'Transaction signature already redeemed' });
  }

  const stored = await upstash(['GET', `apikey:${apiKey}`]);
  if (!stored.result) return res.status(500).json({ error: 'Issued API key could not be retrieved' });
  if (issued.result === 1) {
    await notifyPaymentReceived({ amountLamports: Number(requiredLamports), signature, source: '/api/paywall (10-credit pass)', payer: wallet });
  }
  return res.status(200).json({ success: true, apiKey, credits: JSON.parse(stored.result).credits, asset: 'SOL', amountSol, lamports: Number(requiredLamports) });
}
