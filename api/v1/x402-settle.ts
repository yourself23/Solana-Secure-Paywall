const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
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
  requiredLamports: number,
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

  const rpc = async (method: string, params: any[]) => {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return r.json();
  };

  if (!txSig && serializedTx) {
    const sendRes = await rpc('sendTransaction', [serializedTx, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    if (sendRes?.error || !sendRes?.result) {
      await logEvent('PAYMENT_TX_REJECTED', `Broadcast failed: ${sendRes?.error?.message || 'unknown'}`);
      return { ok: false, error: sendRes?.error?.message || 'Failed to broadcast signed SOL transaction' };
    }
    txSig = sendRes.result;
  }

  if (!txSig) return { ok: false, error: 'Invalid PAYMENT-SIGNATURE header format' };

  const sigKey = `spent_sol_sig:${txSig}`;
  const claim = await upstash(['SET', sigKey, 'x402-native-sol', 'EX', 2592000, 'NX']);
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

  const keys = (tx.transaction?.message?.accountKeys || []).map((k: any) => typeof k === 'string' ? k : k.pubkey);
  const idx = keys.indexOf(receiver);
  const receivedLamports = idx >= 0 ? BigInt(tx.meta.postBalances[idx] || 0) - BigInt(tx.meta.preBalances[idx] || 0) : 0n;

  if (receivedLamports < BigInt(requiredLamports)) {
    await upstash(['DEL', sigKey]);
    return { ok: false, error: `Insufficient native SOL transfer (received ${receivedLamports} lamports)` };
  }

  return { ok: true, txSig };
}
