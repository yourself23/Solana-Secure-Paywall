import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { consumeCall } from '../../lib/credit-store';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_SIGNATURE_AGE_MS = 60_000;
const LIBRARIES = [
  'solana-sniper-daemon', 'mev-arbitrage-bot', 'jito-bundle-dispatcher',
  'liquidity-pool-sniffer', 'raydium-swap-automator', 'pump-fun-bonding-curve',
  'whale-wallet-tracker', 'flash-loan-arbitrage', 'multi-wallet-jito-injector',
  'mempool-transaction-streamer', 'token-metadata-sniper', 'anti-rugpull-audit'
];

function verifyWalletOwnership(wallet: string, timestamp: string, signatureBase58: string): boolean {
  try {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SIGNATURE_AGE_MS) return false;
    const message = new TextEncoder().encode(`invoke:${wallet}:${timestamp}`);
    const signatureBytes = bs58.decode(signatureBase58);
    const pubkeyBytes = new PublicKey(wallet).toBytes();
    return nacl.sign.detached.verify(message, signatureBytes, pubkeyBytes);
  } catch { return false; }
}

async function executeLibrary(libraryId: string, params: any): Promise<any> {
  if (!LIBRARIES.includes(libraryId)) throw new Error('Library not found');
  return { libraryId, params, result: `Executed ${libraryId} with params: ${JSON.stringify(params)}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const wallet = (req.headers['x-wallet-address'] as string)?.trim();
  const timestamp = (req.headers['x-auth-timestamp'] as string)?.trim();
  const authSignature = (req.headers['x-auth-signature'] as string)?.trim();
  const libraryId = ((req.query?.libraryId as string) || (req.body?.libraryId as string))?.trim();

  if (!wallet || !timestamp || !authSignature || !libraryId) {
    return res.status(401).json({ 
      error: 'Missing authentication headers (x-wallet-address, x-auth-timestamp, x-auth-signature) or libraryId' 
    });
  }

  if (!verifyWalletOwnership(wallet, timestamp, authSignature)) {
    return res.status(403).json({ error: 'Invalid or expired SIWS wallet signature' });
  }

  const access = await consumeCall(wallet, libraryId);

  if (!access.allowed) {
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', (BigInt(Math.round(parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1') * 1_000_000_000))).toString());
    res.setHeader('X-Payment-Recipient', process.env.TREASURY_ADDRESS || '');
    res.setHeader('X-Payment-Network', 'solana-mainnet');
    res.setHeader('X-Payment-Asset', 'SOL');
    return res.status(402).json({
      error: 'Payment Required',
      libraryId,
      amountLamports: BigInt(Math.round(parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1') * 1_000_000_000)).toString(),
      amountSol: parseFloat(process.env.PAYMENT_AMOUNT_SOL || '0.1'),
      recipient: process.env.TREASURY_ADDRESS,
      trialCallsRemaining: access.mode === 'trial' ? access.remaining : 0,
    });
  }

  try {
    const params = req.query || req.body || {};
    const output = await executeLibrary(libraryId, params);
    return res.status(200).json({
      success: true,
      accessMode: access.mode,
      remainingCalls: access.remaining,
      data: output,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Library execution failed', details: err?.message });
  }
}
