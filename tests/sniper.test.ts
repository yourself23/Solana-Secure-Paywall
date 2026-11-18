import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadSniperConfig, pollSniper } from '../worker/sniper-job.js';
import status from '../api/sniper-status.js';

const wallet = Keypair.generate();
const input = Keypair.generate().publicKey.toBase58();
const output = Keypair.generate().publicKey.toBase58();
const state = new Map<string, string>();
let threshold = '890';
let swapCalls = 0;
let quoteCalls = 0;
const transaction = new VersionedTransaction(new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: Keypair.generate().publicKey.toBase58(),
  instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 1 })],
}).compileToV0Message());

Object.assign(process.env, {
  SNIPER_JOB_ID: 'job-1',
  SNIPER_INPUT_MINT: input,
  SNIPER_OUTPUT_MINT: output,
  SNIPER_USER_PUBLIC_KEY: wallet.publicKey.toBase58(),
  SNIPER_INPUT_AMOUNT: '1000',
  SNIPER_MIN_OUTPUT_AMOUNT: '900',
  JUPITER_API_KEY: 'test-key',
  UPSTASH_REDIS_REST_URL: 'https://redis.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-token',
  SNIPER_STATUS_SECRET: 'test-status-secret',
});

globalThis.fetch = async (inputUrl, init) => {
  const url = String(inputUrl);
  if (url === 'https://redis.test') {
    const [op, ...args] = JSON.parse(String(init?.body));
    let result: unknown;
    if (op === 'GET') result = state.get(args[0]) ?? null;
    else if (op === 'SET') {
      if (args.includes('NX') && state.has(args[0])) result = null;
      else { state.set(args[0], args[1]); result = 'OK'; }
    } else if (op === 'EVAL' && args[1] === 2) {
      const [, , key, lockKey, lock, record] = args;
      if (state.get(lockKey) === lock) { state.set(key, record); result = 1; }
      else result = 0;
    } else if (op === 'EVAL' && args[1] === 1) {
      const [, , lockKey, lock] = args;
      result = state.get(lockKey) === lock && state.delete(lockKey) ? 1 : 0;
    } else throw new Error(`Unexpected Redis command ${op}`);
    return Response.json({ result });
  }
  if (url.startsWith('https://api.jup.ag/swap/v1/quote?')) {
    quoteCalls++;
    return Response.json({ inputMint: input, outputMint: output, inAmount: '1000', outAmount: '950', otherAmountThreshold: threshold, swapMode: 'ExactIn', slippageBps: 50 });
  }
  if (url === 'https://api.jup.ag/swap/v1/swap') {
    swapCalls++;
    return Response.json({ swapTransaction: Buffer.from(transaction.serialize()).toString('base64'), lastValidBlockHeight: 100 });
  }
  throw new Error(`Unexpected URL ${url}`);
};

function response() {
  const result: { statusCode: number; body: any; headers: Record<string, string> } = { statusCode: 0, body: undefined, headers: {} };
  const res = {
    status(code: number) { result.statusCode = code; return this; },
    json(body: unknown) { result.body = body; return this; },
    setHeader(name: string, value: string) { result.headers[name.toLowerCase()] = value; return this; },
  };
  return { result, res: res as unknown as VercelResponse };
}
function request(auth: string) {
  return { method: 'GET', query: { id: 'job-1' }, headers: { authorization: auth } } as unknown as VercelRequest;
}

test('sniper waits for slippage-adjusted minimum and persists one unsigned plan', async () => {
  const config = loadSniperConfig(process.env);
  await pollSniper(config);
  assert.equal(JSON.parse(state.get('sniper:job:job-1')!).status, 'monitoring');
  assert.equal(swapCalls, 0);

  threshold = '920';
  await pollSniper(config);
  const saved = JSON.parse(state.get('sniper:job:job-1')!);
  assert.equal(saved.status, 'ready');
  assert.equal(saved.plan.lastValidBlockHeight, 100);
  assert.equal(saved.plan.swapTransaction, Buffer.from(transaction.serialize()).toString('base64'));
  await pollSniper(config);
  assert.equal(swapCalls, 1);
  await assert.rejects(() => pollSniper({ ...config, minOutputAmount: '901' }), /different configuration/);

  const unauthorized = response();
  await status(request('Bearer wrong'), unauthorized.res);
  assert.equal(unauthorized.result.statusCode, 401);
  const authorized = response();
  await status(request('Bearer test-status-secret'), authorized.res);
  assert.equal(authorized.result.statusCode, 200);
  assert.equal(authorized.result.headers['cache-control'], 'no-store');
  assert.equal(authorized.result.body.plan.swapTransaction, saved.plan.swapTransaction);
});

test('sniper validates configuration before running', () => {
  assert.throws(() => loadSniperConfig({ ...process.env, SNIPER_INTERVAL_MS: '1000' }), /Invalid sniper/);
  assert.throws(() => loadSniperConfig({ ...process.env, SNIPER_JOB_ID: '../bad' }), /SNIPER_JOB_ID/);
});

test('sniper records quote errors, retries, and respects another worker lock', async () => {
  const config = { ...loadSniperConfig(process.env), id: 'job-error' };
  state.set('sniper:job:job-error:lock', 'another-worker');
  const previousQuotes = quoteCalls;
  await pollSniper(config);
  assert.equal(quoteCalls, previousQuotes);
  state.delete('sniper:job:job-error:lock');

  threshold = 'invalid';
  await assert.rejects(() => pollSniper(config), /Invalid minimum output/);
  const failed = JSON.parse(state.get('sniper:job:job-error')!);
  assert.equal(failed.status, 'error');
  assert.equal(swapCalls, 1);
  threshold = '920';
  await pollSniper(config);
  assert.equal(JSON.parse(state.get('sniper:job:job-error')!).status, 'ready');
  assert.equal(swapCalls, 2);
});
