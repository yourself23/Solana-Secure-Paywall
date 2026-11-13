import { Redis } from '@upstash/redis';
import { createPublicClient, http, parseAbiItem, decodeEventLog, getAddress } from 'viem';
import { base } from 'viem/chains';

const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL!),
});

const MAX_TRIAL_CALLS = 2;

export async function consumeCall(wallet: string, libraryId: string): Promise<{ allowed: boolean; mode: 'paid' | 'trial' | 'none'; remaining: number }> {
  const key = wallet.toLowerCase();
  const currentCredits = (await redis.hget<number>(`credits:${key}`, libraryId)) ?? 0;

  if (currentCredits > 0) {
    const updated = await redis.hincrby(`credits:${key}`, libraryId, -1);
    if (updated >= 0) {
      return { allowed: true, mode: 'paid', remaining: updated };
    }
    await redis.hincrby(`credits:${key}`, libraryId, 1);
  }

  const trialsUsed = await redis.incr(`trials:${key}`);
  if (trialsUsed <= MAX_TRIAL_CALLS) {
    return { allowed: true, mode: 'trial', remaining: MAX_TRIAL_CALLS - trialsUsed };
  }
  await redis.decr(`trials:${key}`);
  return { allowed: false, mode: 'none', remaining: 0 };
}

export async function verifyAndCreditPayment(
  rawTxHash: string,
  expectedPayer: string,
  libraryId: string
): Promise<{ success: boolean; error?: string; credits?: number }> {
  if (!process.env.TREASURY_ADDRESS) {
    throw new Error('Server misconfiguration: TREASURY_ADDRESS missing');
  }

  const txHash = rawTxHash.trim().toLowerCase() as `0x${string}`;
  const normalizedPayer = getAddress(expectedPayer);
  const treasury = getAddress(process.env.TREASURY_ADDRESS);
  const minUnits = BigInt(process.env.USDC_MIN_UNITS || '100000');
  const callsPerPayment = Number(process.env.API_CALLS_PER_PAYMENT || '60');
  const sigKey = `spent_base_tx:${txHash}`;

  const claimed = await redis.set(sigKey, normalizedPayer, { nx: true, ex: 86400 * 30 });
  if (claimed !== 'OK') {
    return { success: false, error: 'Transaction hash already redeemed' };
  }

  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      await redis.del(sigKey);
      return { success: false, error: 'Transaction failed on-chain' };
    }

    let validTransfer = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_BASE_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: [TRANSFER_EVENT],
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.args.from &&
          decoded.args.to &&
          decoded.args.value !== undefined &&
          getAddress(decoded.args.from) === normalizedPayer &&
          getAddress(decoded.args.to) === treasury &&
          decoded.args.value >= minUnits
        ) {
          validTransfer = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!validTransfer) {
      await redis.del(sigKey);
      return { success: false, error: 'No valid USDC transfer to treasury found' };
    }

    const newBalance = await redis.hincrby(`credits:${normalizedPayer.toLowerCase()}`, libraryId, callsPerPayment);
    return { success: true, credits: newBalance };
  } catch (err: any) {
    await redis.del(sigKey);
    throw new Error(`Base RPC verification failure: ${err?.message || 'Unknown RPC error'}`);
  }
}
