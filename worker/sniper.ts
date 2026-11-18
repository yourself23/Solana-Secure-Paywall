import 'dotenv/config';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadSniperConfig, pollSniper } from './sniper-job.js';

const config = loadSniperConfig(process.env);
const shutdown = new AbortController();
process.once('SIGINT', () => shutdown.abort());
process.once('SIGTERM', () => shutdown.abort());

console.log(`Starting sniper job ${config.id}`);
while (!shutdown.signal.aborted) {
  try {
    await pollSniper(config);
  } catch (error) {
    console.error('Sniper poll failed:', error instanceof Error ? error.message : error);
  }
  try {
    await sleep(config.intervalMs, undefined, { signal: shutdown.signal });
  } catch (error) {
    if (!shutdown.signal.aborted) throw error;
  }
}
