import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const CRON_SECRET = process.env.CRON_SECRET!;
const VERCEL_URL = process.env.VERCEL_URL!;
const RPC_URL = process.env.SOLANA_RPC_URL!;
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS!;
const PAYOUT_WALLET_KEYPAIR = process.env.PAYOUT_WALLET_KEYPAIR;

let isRunning = false;

async function sweep() {
  if (isRunning) { console.log('[DAEMON] Sweep already running, skipping'); return; }
  isRunning = true;
  const start = Date.now();
  try {
    console.log('[DAEMON] Starting payout sweep...');
    const res = await fetch(`${VERCEL_URL}/api/payout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[DAEMON] Sweep failed: ${res.status}`, data);
    } else {
      console.log('[DAEMON] Sweep completed:', data);
    }
  } catch (err: any) {
    console.error('[DAEMON] Sweep network error:', err.message);
  } finally {
    console.log(`[DAEMON] Sweep finished in ${Date.now() - start}ms`);
    isRunning = false;
  }
}

setInterval(sweep, 5 * 60 * 1000);
sweep();

console.log('[DAEMON] Payout daemon started - sweeping every 5 minutes');
console.log('[DAEMON] Press Ctrl+C to stop');

process.on('SIGINT', () => { console.log('[DAEMON] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[DAEMON] Shutting down...'); process.exit(0); });
