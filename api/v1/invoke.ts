import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyMessage, getAddress } from 'viem';
import { consumeCall } from '../lib/credit-store';

const MAX_SIGNATURE_AGE_MS = 60_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawWallet = req.headers['x-wallet-address'] as string;
  const timestamp = req.headers['x-auth-timestamp'] as string;
  const signature = req.headers['x-auth-signature'] as string;
  const libraryId = (req.query?.libraryId || req.body?.libraryId) as string;

  if (!rawWallet || !timestamp || !signature || !libraryId) {
    return res.status(401).json({
      error: 'Missing authentication headers (x-wallet-address, x-auth-timestamp, x-auth-signature) or libraryId',
    });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SIGNATURE_AGE_MS) {
    return res.status(403).json({ error: 'Expired or invalid timestamp' });
  }

  let wallet: `0x${string}`;
  try {
    wallet = getAddress(rawWallet);
    const valid = await verifyMessage({
      address: wallet,
      message: `invoke:${wallet.toLowerCase()}:${timestamp}`,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return res.status(403).json({ error: 'Invalid EIP-191 wallet signature' });
    }
  } catch {
    return res.status(403).json({ error: 'Signature verification failed' });
  }

  const access = await consumeCall(wallet, libraryId);
  if (!access.allowed) {
    const treasury = process.env.TREASURY_ADDRESS || '';
    const minUnits = process.env.USDC_MIN_UNITS || '100000';
    res.setHeader('X-Payment-Required', 'true');
    res.setHeader('X-Payment-Amount', minUnits);
    res.setHeader('X-Payment-Recipient', treasury);
    res.setHeader('X-Payment-Network', 'base-mainnet');
    res.setHeader('X-Payment-Asset', 'USDC');
    return res.status(402).json({
      error: 'Payment Required',
      network: 'base-mainnet',
      asset: 'USDC',
      recipient: treasury,
      minUnits,
      trialCallsRemaining: 0,
    });
  }

  try {
    const libraryModule = await import(`../libraries/${libraryId}`);
    const execute = libraryModule.default || libraryModule.run;
    const output = await execute(req.query || req.body);
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
