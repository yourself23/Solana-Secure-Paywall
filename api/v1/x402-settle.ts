const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export async function settleX402Header(
  rawHeader: string,
  receiver: string,
  requiredUnits: number,
  rpcUrl: string,
  upstash: (cmd: (string | number)[]) => Promise<any>,
  logEvent: (type: string, detail: string) => Promise<void>
): Promise<{ ok: boolean; txSig?: string; error?: string }> {
  let txSig: string | undefined;
  let serializedTx: string | undefined;

  try {
    const decoded = JSON.parse(Buffer.from(rawHeader, 'base64').toString('utf8'));
    const p = decoded?.payload || decoded;
    if (typeof p?.transaction === 'string' && p.transaction.length > 100) serializedTx = p.transaction;
    else if (typeof p?.serializedTransaction === 'string') serializedTx = p.serializedTransaction;
    else if (typeof p?.signature === 'string') txSig = p.signature;
  } catch {
    if (rawHeader.length >= 64 && rawHeader.length <= 100 && !rawHeader.includes('=')) txSig = rawHeader;
    else if (rawHeader.length > 120) serializedTx = rawHeader;
  }

  const rpc = async (method: string, params: any[]) => {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
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

  if (!txSig) {
    await logEvent('PAYMENT_HEADER_ERR', 'Unreadable PAYMENT-SIGNATURE header');
    return { ok: false, error: 'Invalid PAYMENT-SIGNATURE header format' };
  }

  const sigKey = `spent_usdc_sig:${txSig}`;
  const claim = await upstash(['SET', sigKey, 'x402-header', 'EX', 2592000, 'NX']);
  if (claim.result !== 'OK') {
    await logEvent('REPLAY_BLOCKED', `Duplicate x402 tx ${txSig.slice(0, 8)}...`);
    return { ok: false, error: 'Transaction signature already redeemed' };
  }

  let tx = null;
  for (let i = 0; i < 4; i++) {
    const res = await rpc('getTransaction', [txSig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (res?.result) { tx = res.result; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!tx || tx.meta?.err) {
    await upstash(['DEL', sigKey]);
    await logEvent('PAYMENT_UNCONFIRMED', `Tx ${txSig.slice(0, 8)}... not confirmed on-chain`);
    return { ok: false, error: 'Transaction not found or failed on-chain' };
  }

  const post = (tx.meta?.postTokenBalances || []).find((b: any) => b.mint === USDC_MINT && b.owner === receiver);
  const pre = (tx.meta?.preTokenBalances || []).find((b: any) => b.accountIndex === post?.accountIndex);
  const received = BigInt(post?.uiTokenAmount?.amount || '0') - BigInt(pre?.uiTokenAmount?.amount || '0');

  if (received < BigInt(requiredUnits)) {
    await upstash(['DEL', sigKey]);
    await logEvent('UNDERPAYMENT', `Got ${received} units, needed ${requiredUnits}`);
    return { ok: false, error: 'Insufficient USDC transfer' };
  }

  return { ok: true, txSig };
}
