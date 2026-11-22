import { createHash, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { runLiveSolanaEngine } from '../api/_lib/engines.js';
import { sniperJobKey, sniperRedis, validSniperJobId } from '../api/_lib/sniper-store.js';

export type SniperConfig = {
  id: string;
  inputMint: string;
  outputMint: string;
  userPublicKey: string;
  amount: string;
  minOutputAmount: string;
  slippageBps: number;
  intervalMs: number;
};

export function loadSniperConfig(env: NodeJS.ProcessEnv): SniperConfig {
  const id = env.SNIPER_JOB_ID?.trim() || '';
  if (!validSniperJobId(id)) throw new Error('SNIPER_JOB_ID must contain 1-64 letters, numbers, underscores or hyphens');
  let inputMint: string;
  let outputMint: string;
  let userPublicKey: string;
  try {
    inputMint = new PublicKey(env.SNIPER_INPUT_MINT?.trim() || '').toBase58();
    outputMint = new PublicKey(env.SNIPER_OUTPUT_MINT?.trim() || '').toBase58();
    userPublicKey = new PublicKey(env.SNIPER_USER_PUBLIC_KEY?.trim() || '').toBase58();
  } catch {
    throw new Error('Valid SNIPER_INPUT_MINT, SNIPER_OUTPUT_MINT and SNIPER_USER_PUBLIC_KEY are required');
  }
  const amount = env.SNIPER_INPUT_AMOUNT?.trim() || '';
  const minOutputAmount = env.SNIPER_MIN_OUTPUT_AMOUNT?.trim() || '';
  const slippageBps = Number(env.SNIPER_SLIPPAGE_BPS?.trim() || 50);
  const intervalMs = Number(env.SNIPER_INTERVAL_MS?.trim() || 30000);
  if (inputMint === outputMint || !/^[1-9]\d*$/.test(amount) || !/^[1-9]\d*$/.test(minOutputAmount) ||
      !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 10000 ||
      !Number.isSafeInteger(intervalMs) || intervalMs < 5000 || intervalMs > 3600000) {
    throw new Error('Invalid sniper mints, atomic amounts, slippage or polling interval');
  }
  if (!env.JUPITER_API_KEY?.trim()) throw new Error('JUPITER_API_KEY is required');
  if (!env.UPSTASH_REDIS_REST_URL?.trim() || !env.UPSTASH_REDIS_REST_TOKEN?.trim()) throw new Error('Upstash Redis is required');
  return { id, inputMint, outputMint, userPublicKey, amount, minOutputAmount, slippageBps, intervalMs };
}

export async function pollSniper(config: SniperConfig) {
  const { intervalMs: _intervalMs, ...job } = config;
  const configHash = createHash('sha256').update(JSON.stringify(job)).digest('hex');
  const key = sniperJobKey(config.id);
  const lockKey = `${key}:lock`;
  const lock = randomUUID();
  if (await sniperRedis(['SET', lockKey, lock, 'NX', 'EX', 90]) !== 'OK') return;

  try {
    const saved = await sniperRedis(['GET', key]);
    const prior = saved ? JSON.parse(saved) : null;
    if (prior && prior.configHash !== configHash) throw new Error('Job ID already belongs to a different configuration; use a new SNIPER_JOB_ID');
    if (prior?.status === 'ready') return;

    let record: Record<string, unknown>;
    try {
      const result = await runLiveSolanaEngine('cross-dex-router', '', job);
      if (result.status === 'threshold_not_met') {
        record = { status: 'monitoring', configHash, updatedAt: new Date().toISOString(), quote: result.quote };
      } else if (result.status === 'unsigned' && 'swapTransaction' in result && result.swapTransaction &&
                 Number.isSafeInteger(result.lastValidBlockHeight) && result.lastValidBlockHeight > 0) {
        record = { status: 'ready', configHash, updatedAt: new Date().toISOString(), plan: result };
      } else {
        throw new Error('Jupiter did not return an unsigned swap plan');
      }
    } catch (error) {
      record = { status: 'error', configHash, updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Sniper poll failed' };
    }
    const stored = await sniperRedis(['EVAL', `
      if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
      redis.call('SET', KEYS[1], ARGV[2])
      return 1
    `, 2, key, lockKey, lock, JSON.stringify(record)]);
    if (stored !== 1) throw new Error('Sniper worker lost its lock before storing the result');
    if (record.status === 'error') throw new Error(String(record.error));
  } finally {
    await sniperRedis(['EVAL', `
      if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
      return 0
    `, 1, lockKey, lock]);
  }
}
