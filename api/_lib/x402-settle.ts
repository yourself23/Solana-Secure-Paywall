import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PublicKey } from '@solana/web3.js';

const NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

export async function handleX402(
  req: VercelRequest,
  res: VercelResponse,
  receiver: string,
  lamports: number,
  execute: () => Promise<Record<string, unknown>>,
) {
  const facilitator = (process.env.X402_FACILITATOR_URL || 'https://facilitator.payai.network').replace(/\/+$/, '');
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!redisUrl || !redisToken) return res.status(503).json({ error: 'Payment store unconfigured' });
  try { new PublicKey(receiver); } catch { return res.status(500).json({ error: 'Invalid treasury address' }); }
  if (!Number.isSafeInteger(lamports) || lamports <= 0) return res.status(500).json({ error: 'Invalid SOL payment amount' });

  const redis = async (command: (string | number)[]) => {
    const response = await fetch(redisUrl, { method: 'POST', headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(`Payment store error: ${result.error || response.status}`);
    return result.result;
  };
  const callFacilitator = async (path: string, body?: unknown) => {
    const token = process.env.X402_FACILITATOR_TOKEN?.trim();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${facilitator}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(body === undefined ? 10000 : 30000),
    });
    if (!response.ok) throw new Error(`Facilitator ${path} failed with HTTP ${response.status}`);
    return response.json();
  };

  let extra: Record<string, unknown>;
  try {
    const supported = await callFacilitator('supported');
    const kind = supported.kinds?.find((item: any) => item.x402Version === 2 && item.scheme === 'exact' && item.network === NETWORK);
    if (!kind?.extra?.feePayer) throw new Error('Facilitator does not advertise an x402 v2 Solana fee payer');
    extra = { feePayer: kind.extra.feePayer };
    if (kind.extra.transactionVersions) extra.transactionVersions = kind.extra.transactionVersions;
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Facilitator unavailable' });
  }
  const requirements = { scheme: 'exact', network: NETWORK, amount: String(lamports), asset: WRAPPED_SOL, payTo: receiver, maxTimeoutSeconds: 300, extra };
  const host = req.headers.host;
  const baseUrl = process.env.APP_URL?.trim() || (host ? `https://${host}` : '');
  if (!baseUrl) return res.status(500).json({ error: 'APP_URL or Host header is required' });
  const resource = { url: new URL(req.url || '/', baseUrl).toString(), mimeType: 'application/json' };
  const rawHeader = (req.headers['payment-signature'] || req.headers['x-payment']) as string | undefined;
  if (!rawHeader) {
    const challenge = { x402Version: 2, resource, accepts: [requirements] };
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(challenge)).toString('base64'));
    return res.status(402).json({ error: 'Payment Required', ...challenge });
  }

  let paymentPayload: any;
  try {
    paymentPayload = JSON.parse(Buffer.from(rawHeader, 'base64').toString('utf8'));
  } catch {
    return res.status(402).json({ error: 'Invalid PAYMENT-SIGNATURE' });
  }
  const accepted = paymentPayload?.accepted;
  if (paymentPayload?.x402Version !== 2 || typeof paymentPayload?.payload?.transaction !== 'string' ||
      accepted?.scheme !== requirements.scheme || accepted?.network !== requirements.network ||
      accepted?.amount !== requirements.amount || accepted?.asset !== requirements.asset ||
      accepted?.payTo !== requirements.payTo || accepted?.maxTimeoutSeconds !== requirements.maxTimeoutSeconds ||
      accepted?.extra?.feePayer !== extra.feePayer ||
      JSON.stringify(accepted?.extra?.transactionVersions || null) !== JSON.stringify(extra.transactionVersions || null) ||
      Object.keys(accepted?.extra || {}).some((key) => key !== 'feePayer' && key !== 'transactionVersions') ||
      (paymentPayload.resource?.url && paymentPayload.resource.url !== resource.url)) {
    return res.status(402).json({ error: 'Payment does not match the offered requirements' });
  }

  const transaction = paymentPayload.payload.transaction;
  const transactionBytes = Buffer.from(transaction, 'base64');
  if (!transactionBytes.length || transactionBytes.length > 1232 || transactionBytes.toString('base64') !== transaction) {
    return res.status(402).json({ error: 'Invalid serialized Solana transaction' });
  }
  const txHash = createHash('sha256').update(transactionBytes).digest('hex');
  const requestHash = createHash('sha256').update(JSON.stringify([req.method, resource.url, req.body])).digest('hex');
  const key = `x402:payment:${txHash}`;
  const complete = async (paymentResponse: string, body: Record<string, unknown>) => {
    await redis(['EVAL', `
      local existing = redis.call('GET', KEYS[1])
      if not existing then return redis.error_reply('Payment reservation missing') end
      if cjson.decode(existing).state == 'complete' then return 0 end
      redis.call('SET', KEYS[1], ARGV[1])
      redis.call('HINCRBYFLOAT', KEYS[2], 'total_wsol_earned', ARGV[2])
      return 1
    `, 2, key, 'telemetry:stats', JSON.stringify({ state: 'complete', requestHash, paymentResponse, body }), lamports / 1_000_000_000]);
    res.setHeader('PAYMENT-RESPONSE', paymentResponse);
    return res.status(200).json(body);
  };
  let locked = false;
  let settling = false;
  let knownTransaction: string | undefined;
  try {
    const claim = await redis(['SET', key, JSON.stringify({ state: 'pending', requestHash }), 'NX']);
    if (claim !== 'OK') {
      const saved = await redis(['GET', key]);
      const prior = saved ? JSON.parse(saved) : null;
      if (prior?.state === 'complete' && prior.requestHash === requestHash) {
        res.setHeader('PAYMENT-RESPONSE', prior.paymentResponse);
        return res.status(200).json(prior.body);
      }
      if (prior?.state === 'settlement_pending' && prior.requestHash === requestHash && prior.transaction) {
        const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
        const rpcResponse = await fetch(rpcUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[prior.transaction], { searchTransactionHistory: true }] }),
        });
        if (!rpcResponse.ok) throw new Error(`Solana RPC HTTP ${rpcResponse.status}`);
        const statusResponse = await rpcResponse.json();
        if (statusResponse.error) throw new Error(`Solana RPC: ${statusResponse.error.message || 'request failed'}`);
        const status = statusResponse.result?.value?.[0];
        if (status?.err) {
          await redis(['DEL', key]);
          return res.status(402).json({ error: 'Settlement transaction failed on chain' });
        }
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
          const paymentResponse = Buffer.from(JSON.stringify({ success: true, transaction: prior.transaction, network: NETWORK })).toString('base64');
          return await complete(paymentResponse, { success: true, txSignature: prior.transaction, ...prior.data });
        }
        return res.status(409).json({ error: 'Payment settlement is still pending', transaction: prior.transaction });
      }
      return res.status(409).json({ error: 'Payment is already in progress or has been redeemed' });
    }
    locked = true;
    const payload = { paymentPayload, paymentRequirements: requirements };
    const verification = await callFacilitator('verify', payload);
    if (!verification.isValid) {
      await redis(['DEL', key]);
      return res.status(402).json({ error: verification.invalidReason || 'Payment verification failed' });
    }
    const data = await execute();
    await redis(['SET', key, JSON.stringify({ state: 'settling', requestHash, data })]);
    settling = true;
    const settlement = await callFacilitator('settle', payload);
    knownTransaction = typeof settlement.transaction === 'string' && settlement.transaction ? settlement.transaction : undefined;
    if (!settlement.success || !settlement.transaction || settlement.network !== NETWORK) {
      if (settlement.errorReason === 'settlement_pending' && settlement.transaction && settlement.network === NETWORK) {
        await redis(['SET', key, JSON.stringify({ state: 'settlement_pending', requestHash, transaction: settlement.transaction, data })]);
      } else if (settlement.success === false && !knownTransaction && settlement.errorReason && settlement.errorReason !== 'settlement_pending') {
        await redis(['DEL', key]);
      }
      return res.status(503).json({ error: settlement.errorReason || 'Payment settlement failed', transaction: settlement.transaction || undefined });
    }
    const paymentResponse = Buffer.from(JSON.stringify(settlement)).toString('base64');
    const body = { success: true, txSignature: settlement.transaction, ...data };
    return await complete(paymentResponse, body);
  } catch (error) {
    if (locked && !settling) await redis(['DEL', key]);
    return res.status(503).json({ error: error instanceof Error ? error.message : 'Payment processing failed', ...(settling ? { paymentStatus: 'unknown; contact the operator before retrying', transaction: knownTransaction } : {}) });
  }
}
