const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const DEFAULT_FEE_PAYER = '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4';

export async function getSolanaFeePayer(): Promise<string> {
  if (process.env.X402_FEE_PAYER?.trim()) return process.env.X402_FEE_PAYER.trim();
  try {
    const u = ['https:/', 'facilitator.payai.network', 'supported'].join('/');
    const r = await fetch(u, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const json = await r.json();
      const kinds = Array.isArray(json?.kinds) ? json.kinds : [];
      const solKind = kinds.find((k: any) => k.network === SOLANA_NETWORK && k.extra?.feePayer);
      if (solKind?.extra?.feePayer) return solKind.extra.feePayer;
    }
  } catch {}
  return DEFAULT_FEE_PAYER;
}

export async function settleX402Header(
  rawHeader: string,
  receiver: string,
  requiredUnits: number,
  rpcUrl: string,
  upstash: (cmd: (string | number)[]) => Promise<any>,
  logEvent: (type: string, detail: string) => Promise<void>,
  feePayer: string = DEFAULT_FEE_PAYER
): Promise<{ ok: boolean; txSig?: string; error?: string }> {
  let decodedObj: any = null;
  let txSig: string | undefined;
  let serializedTx: string | undefined;

  try {
    decodedObj = JSON.parse(Buffer.from(rawHeader, 'base64').toString('utf8'));
    const p = decodedObj?.payload || decodedObj;
    if (typeof p?.transaction === 'string' && p.transaction.length > 100) serializedTx = p.transaction;
    else if (typeof p?.serializedTransaction === 'string') serializedTx = p.serializedTransaction;
    else if (typeof p?.signature === 'string') txSig = p.signature;
  } catch {
    if (rawHeader.length >= 64 && rawHeader.length <= 100 && !rawHeader.includes('=')) txSig = rawHeader;
    else if (rawHeader.length > 120) serializedTx = rawHeader;
  }
  if (decodedObj && serializedTx) {
    try {
      const settleUrl = ['https:/', 'facilitator.payai.network', 'settle'].join('/');
      const reqObj = { scheme: 'exact', network: SOLANA_NETWORK, amount: requiredUnits.toString(), asset: USDC_MINT, payTo: receiver, maxTimeoutSeconds: 300, extra: { feePayer } };
      const facRes = await fetch(settleUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x402Version: 2, paymentPayload: decodedObj, paymentRequirements: reqObj }) });
      const facJson = await facRes.json().catch(() => null);
      const settledHash = facJson?.transaction || facJson?.txHash || facJson?.signature;
      if (facRes.ok && facJson?.success && settledHash) {
        await upstash(['SET', `spent_usdc_sig:${settledHash}`, 'x402-facilitator', 'EX', 2592000, 'NX']);
        return { ok: true, txSig: settledHash };
      }
    } catch {}
  }

  const rpc = async (method: string, params: any[]) => {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return r.json();
  };

  if (!txSig && serializedTx) {
    const sendRes = await rpc('sendTransaction', [serializedTx, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    if (sendRes?.error || !sendRes?.result) {
      await logEvent('PAYMENT_TX_REJECTED', `Broadcast failed: ${sendRes?.error?.message || 'unknown'}`);
      return { ok: false, error: sendRes?.error?.message || 'Failed to broadcast signed x402 transaction' };
    }
    txSig = sendRes.result;
  }

  if (!txSig) return { ok: false, error: 'Invalid PAYMENT-SIGNATURE header format' };

  const sigKey = `spent_usdc_sig:${txSig}`;
  const claim = await upstash(['SET', sigKey, 'x402-header', 'EX', 2592000, 'NX']);
  if (claim.result !== 'OK') return { ok: false, error: 'Transaction signature already redeemed' };

  let tx = null;
  for (let i = 0; i < 4; i++) {
    const res = await rpc('getTransaction', [txSig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (res?.result) { tx = res.result; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!tx || tx.meta?.err) {
    await upstash(['DEL', sigKey]);
    return { ok: false, error: 'Transaction not found or failed on-chain' };
  }

  const post = (tx.meta?.postTokenBalances || []).find((b: any) => b.mint === USDC_MINT && b.owner === receiver);
  const pre = (tx.meta?.preTokenBalances || []).find((b: any) => b.accountIndex === post?.accountIndex);
  const received = BigInt(post?.uiTokenAmount?.amount || '0') - BigInt(pre?.uiTokenAmount?.amount || '0');

  if (received < BigInt(requiredUnits)) {
    await upstash(['DEL', sigKey]);
    return { ok: false, error: 'Insufficient USDC transfer' };
  }

  return { ok: true, txSig };
}
