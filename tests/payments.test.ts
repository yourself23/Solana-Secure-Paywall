import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import paywall from '../api/paywall.js';
import invoke from '../api/v1/invoke.js';
import mcp from '../api/mcp.js';
import sales from '../api/sales.js';
import { handleX402 } from '../api/_lib/x402-settle.js';
import { runLiveSolanaEngine } from '../api/_lib/engines.js';

test('Solana dependencies load through CommonJS without requiring ES modules', () => {
  const flags = process.allowedNodeEnvironmentFlags.has('--no-experimental-require-module')
    ? ['--no-experimental-require-module']
    : [];
  execFileSync(process.execPath, [...flags, '-e', `
    const { createRequire } = require('node:module');
    const rpcRequire = createRequire(require.resolve('rpc-websockets'));
    const id = rpcRequire('uuid').v1();
    if (!rpcRequire('uuid').validate(id)) throw new Error('Invalid RPC websocket UUID');
    require('@solana/web3.js');
  `], { stdio: 'pipe' });
});

const wallet = Keypair.generate();
const receiver = Keypair.generate().publicKey.toBase58();
const signature = '1'.repeat(88);
const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(wallet.secretKey.slice(0, 32))]),
  format: 'der',
  type: 'pkcs8',
});
const proof = crypto.sign(null, Buffer.from(`paywall:${signature}`), privateKey).toString('base64');
const store = new Map<string, string>();
let settlementCalls = 0;
let failRpc = false;
let settlementPending = false;
const plan = new VersionedTransaction(new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: Keypair.generate().publicKey.toBase58(),
  instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new Keypair().publicKey, lamports: 1 })],
}).compileToV0Message());

process.env.TREASURY_ADDRESS = receiver;
process.env.SOLANA_RPC_URL = 'https://rpc.test';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.PAYWALL_SECRET = 'test-secret';
process.env.X402_FACILITATOR_URL = 'https://facilitator.test';
process.env.APP_URL = 'https://example.test';
process.env.PAYMENT_AMOUNT_SOL = '0.001';

function response() {
  const result: { statusCode: number; body: any; headers: Record<string, string> } = { statusCode: 0, body: undefined, headers: {} };
  const res = {
    status(code: number) { result.statusCode = code; return this; },
    json(body: unknown) { result.body = body; return this; },
    setHeader(name: string, value: string) { result.headers[name.toLowerCase()] = value; return this; },
  };
  return { result, res: res as unknown as VercelResponse };
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return { method: 'POST', url: '/api/v1/invoke?libraryId=whale-wallet-tracker', query: { libraryId: 'whale-wallet-tracker' }, body, headers: { host: 'example.test', ...headers } } as unknown as VercelRequest;
}

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://redis.test') {
    const command = JSON.parse(String(init?.body));
    const [op, ...args] = command;
    let result: unknown = null;
    if (op === 'GET') result = store.get(args[0]) ?? null;
    else if (op === 'DEL') result = store.delete(args[0]) ? 1 : 0;
    else if (op === 'SET') {
      if (args.includes('NX') && store.has(args[0])) result = null;
      else { store.set(args[0], args[1]); result = 'OK'; }
    } else if (op === 'EVAL' && args[0].includes("redis.call('EXISTS', KEYS[2])")) {
      const [, , sigKey, key, , fingerprint, record] = args;
      if (store.has(sigKey)) result = store.get(sigKey) === fingerprint && store.has(key) ? 2 : 0;
      else { store.set(sigKey, fingerprint); store.set(key, record); result = 1; }
    } else if (op === 'EVAL' && args[0].includes("record.credits = record.credits - 1")) {
      const key = args[2];
      const record = JSON.parse(store.get(key) || '{}');
      if (!record.credits) result = -1;
      else { record.credits--; store.set(key, JSON.stringify(record)); result = record.credits; }
    } else if (op === 'EVAL' && args[0].includes('total_wsol_earned')) {
      store.set(args[2], args[4]);
      result = 1;
    } else if (['LPUSH', 'LTRIM', 'HINCRBY', 'HINCRBYFLOAT'].includes(op)) result = 1;
    else throw new Error(`Unexpected Redis command ${op}`);
    return Response.json({ result });
  }
  if (url === 'https://rpc.test') {
    if (failRpc) throw new Error('RPC unavailable');
    const method = JSON.parse(String(init?.body)).method;
    if (method === 'getTransaction') return Response.json({ result: {
      meta: { err: null, preBalances: [2000000, 0], postBalances: [995000, 1000000] },
      transaction: { message: {
        accountKeys: [{ pubkey: wallet.publicKey.toBase58(), signer: true }, { pubkey: receiver, signer: false }],
        instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: wallet.publicKey.toBase58(), destination: receiver, lamports: 1000000 } } }],
      } },
    } });
    if (method === 'getSlot') return Response.json({ result: 1 });
    if (method === 'getLargestAccounts') return Response.json({ result: { value: [] } });
    if (method === 'getSignatureStatuses') return Response.json({ result: { value: [{ err: null, confirmationStatus: 'confirmed' }] } });
    throw new Error(`Unexpected RPC method ${method}`);
  }
  if (url === 'https://facilitator.test/supported') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', extra: { feePayer: receiver } }] });
  if (url === 'https://facilitator.test/verify') return Response.json({ isValid: true });
  if (url === 'https://facilitator.test/settle') {
    settlementCalls++;
    if (settlementPending) return Response.json({ success: false, errorReason: 'settlement_pending', transaction: 'pending-signature', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' });
    return Response.json({ success: true, transaction: 'settled-signature', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' });
  }
  if (url.startsWith('https://api.jup.ag/swap/v1/quote?')) return Response.json({ inAmount: '1000', outAmount: '900' });
  if (url === 'https://api.jup.ag/swap/v1/swap') return Response.json({ swapTransaction: Buffer.from(plan.serialize()).toString('base64'), lastValidBlockHeight: 100 });
  if (url === 'https://api.jup.ag/trigger/v1/createOrder') return Response.json({ transaction: Buffer.from(plan.serialize()).toString('base64'), requestId: 'order-1' });
  if (url === 'https://mainnet.block-engine.jito.wtf/api/v1/getTipAccounts') return Response.json({ result: [receiver] });
  throw new Error(`Unexpected URL ${url}`);
};

test('all payment endpoints default to 0.1 SOL', async () => {
  delete process.env.PAYMENT_AMOUNT_SOL;
  try {
    const metadata = response();
    await sales(request({}), metadata.res);
    assert.equal(metadata.result.body.amountSol, 0.1);
    assert.equal(metadata.result.body.lamports, 100000000);

    const prepaid = response();
    await paywall(request({ signature, wallet: wallet.publicKey.toBase58(), walletProof: proof }), prepaid.res);
    assert.equal(prepaid.result.statusCode, 402);
    assert.match(prepaid.result.body.error, /100000000 lamports/);

    const invokeResult = response();
    await invoke(request({}), invokeResult.res);
    assert.equal(invokeResult.result.statusCode, 402);
    assert.equal(invokeResult.result.body.accepts[0].amount, '100000000');

    const mcpResult = response();
    await mcp(request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whale-wallet-tracker' } }), mcpResult.res);
    assert.equal(mcpResult.result.statusCode, 402);
    assert.equal(mcpResult.result.body.accepts[0].amount, '100000000');
  } finally {
    process.env.PAYMENT_AMOUNT_SOL = '0.001';
  }
});

test('prepaid redemption is recoverable, wallet-bound, and usable for invoke', async () => {
  const body = { signature, wallet: wallet.publicKey.toBase58(), walletProof: proof };
  const first = response();
  await paywall(request(body), first.res);
  assert.equal(first.result.statusCode, 200);
  assert.equal(first.result.body.credits, 10);
  const key = first.result.body.apiKey;

  const invokeResult = response();
  await invoke(request({}, { 'x-api-key': key }), invokeResult.res);
  assert.equal(invokeResult.result.statusCode, 200);
  assert.equal(invokeResult.result.body.remainingCalls, 9);

  const retry = response();
  await paywall(request(body), retry.res);
  assert.equal(retry.result.body.apiKey, key);
  assert.equal(retry.result.body.credits, 9);
  const invalid = response();
  await paywall(request({ ...body, walletProof: 'invalid' }), invalid.res);
  assert.equal(invalid.result.statusCode, 403);
});

test('RPC failure does not consume an unverified payment', async () => {
  const newSignature = '2'.repeat(88);
  const signed = crypto.sign(null, Buffer.from(`paywall:${newSignature}`), privateKey).toString('base64');
  failRpc = true;
  await assert.rejects(() => paywall(request({ signature: newSignature, wallet: wallet.publicKey.toBase58(), walletProof: signed }), response().res), /RPC unavailable/);
  failRpc = false;
  assert.equal(store.has(`spent_sol_sig:${newSignature}`), false);
});

test('x402 verifies wrapped SOL, does not settle on execution failure, and replays completed response', async () => {
  const challenge = response();
  await handleX402(request({}), challenge.res, receiver, 100000, async () => ({ data: 'unused' }));
  assert.equal(challenge.result.statusCode, 402);
  const quote = JSON.parse(Buffer.from(challenge.result.headers['payment-required'], 'base64').toString());
  assert.equal(quote.accepts[0].asset, 'So11111111111111111111111111111111111111112');
  assert.equal(quote.accepts[0].amount, '100000');
  const payload = { x402Version: 2, resource: quote.resource, accepted: quote.accepts[0], payload: { transaction: Buffer.from([1, 2, 3]).toString('base64') } };
  const header = Buffer.from(JSON.stringify(payload)).toString('base64');
  const paidRequest = request({}, { 'payment-signature': header });
  const failed = response();
  await handleX402(paidRequest, failed.res, receiver, 100000, async () => { throw new Error('upstream unavailable'); });
  assert.equal(failed.result.statusCode, 503);
  assert.equal(settlementCalls, 0);

  const paid = response();
  await handleX402(paidRequest, paid.res, receiver, 100000, async () => ({ data: 'delivered' }));
  assert.equal(paid.result.statusCode, 200);
  assert.equal(paid.result.body.data, 'delivered');
  const replay = response();
  await handleX402(paidRequest, replay.res, receiver, 100000, async () => { throw new Error('must not execute again'); });
  assert.equal(replay.result.body.data, 'delivered');
  assert.equal(settlementCalls, 1);
});

test('x402 reconciles a pending settlement without charging again', async () => {
  const challenge = response();
  await handleX402(request({ query: 'pending' }), challenge.res, receiver, 100000, async () => ({}));
  const quote = JSON.parse(Buffer.from(challenge.result.headers['payment-required'], 'base64').toString());
  const payload = { x402Version: 2, resource: quote.resource, accepted: quote.accepts[0], payload: { transaction: Buffer.from([4, 5, 6]).toString('base64') } };
  const header = Buffer.from(JSON.stringify(payload)).toString('base64');
  const paidRequest = request({ query: 'pending' }, { 'payment-signature': header });
  settlementPending = true;
  const pending = response();
  await handleX402(paidRequest, pending.res, receiver, 100000, async () => ({ data: 'recovered' }));
  settlementPending = false;
  assert.equal(pending.result.statusCode, 503);
  assert.equal(pending.result.body.transaction, 'pending-signature');
  const previousCalls = settlementCalls;
  const retry = response();
  await handleX402(paidRequest, retry.res, receiver, 100000, async () => { throw new Error('must not execute again'); });
  assert.equal(retry.result.statusCode, 200);
  assert.equal(retry.result.body.data, 'recovered');
  assert.equal(settlementCalls, previousCalls);
});

test('unimplemented engines fail before payment', async () => {
  const unsupported = request({});
  unsupported.query = { libraryId: 'flash-loan-arbitrage' };
  const result = response();
  await invoke(unsupported, result.res);
  assert.equal(result.result.statusCode, 501);
});

test('Jupiter engines return unsigned swap and limit-order transactions', async () => {
  process.env.JUPITER_API_KEY = 'test-jupiter-key';
  const params = { inputMint: wallet.publicKey.toBase58(), outputMint: receiver, userPublicKey: wallet.publicKey.toBase58(), amount: '1000', takingAmount: '900' };
  const swap = await runLiveSolanaEngine('cross-dex-router', 'https://rpc.test', params);
  assert.equal(swap.status, 'unsigned');
  assert.ok('swapTransaction' in swap);
  assert.equal(swap.swapTransaction, Buffer.from(plan.serialize()).toString('base64'));
  const limit = await runLiveSolanaEngine('limit-order-sniper', 'https://rpc.test', params);
  assert.equal(limit.status, 'unsigned');
  assert.equal(limit.requestId, 'order-1');
  delete process.env.JUPITER_API_KEY;
});

test('Jito plans add an unsigned tip to the last transaction without broadcasting', async () => {
  const encoded = Buffer.from(plan.serialize()).toString('base64');
  const bundle = await runLiveSolanaEngine('jito-bundle-dispatcher', 'https://rpc.test', {
    transactions: [encoded], tipPayer: wallet.publicKey.toBase58(), tipLamports: 1000,
  });
  assert.equal(bundle.status, 'unsigned');
  assert.ok(bundle.transactions);
  const tx = VersionedTransaction.deserialize(Buffer.from(bundle.transactions[0], 'base64'));
  const message = TransactionMessage.decompile(tx.message);
  assert.equal(message.instructions.length, 2);
  assert.equal(message.instructions[1].programId.toBase58(), SystemProgram.programId.toBase58());
  assert.ok(tx.signatures.every((value) => value.every((byte) => byte === 0)));
  await assert.rejects(() => runLiveSolanaEngine('jito-bundle-dispatcher', 'https://rpc.test', {
    transactions: [encoded], tipPayer: receiver, tipLamports: 1000,
  }), /fee payer/);
  const signed = VersionedTransaction.deserialize(plan.serialize());
  signed.sign([wallet]);
  await assert.rejects(() => runLiveSolanaEngine('jito-bundle-dispatcher', 'https://rpc.test', {
    transactions: [Buffer.from(signed.serialize()).toString('base64')], tipPayer: wallet.publicKey.toBase58(), tipLamports: 1000,
  }), /unsigned/);

  const legacy = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [],
  }).compileToLegacyMessage());
  const legacyBundle = await runLiveSolanaEngine('multi-wallet-jito-injector', 'https://rpc.test', {
    transactions: [Buffer.from(legacy.serialize()).toString('base64')], tipPayer: wallet.publicKey.toBase58(), tipLamports: 1000,
  });
  assert.ok(legacyBundle.transactions);
  assert.equal(VersionedTransaction.deserialize(Buffer.from(legacyBundle.transactions[0], 'base64')).message.version, 'legacy');
});
