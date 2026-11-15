import React, { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import { Cpu, Lock, Unlock, Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';

const SOLANA_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const BOT_LIBRARIES = [
  { id: 'whale-wallet-tracker', name: 'Whale Wallet Tracker', tier: 'Whale Intel' },
  { id: 'rug-pull-mint-auditor', name: 'Rug-Pull Mint Auditor', tier: 'Risk Audit' },
  { id: 'priority-fee-oracle', name: 'Priority Fee Oracle', tier: 'MEV & Gas' },
  { id: 'liquidity-pool-sniffer', name: 'Liquidity Pool Sniffer', tier: 'DEX Alpha' },
  { id: 'mempool-alpha-scanner', name: 'Mempool Alpha Scanner', tier: 'DEX Alpha' },
  { id: 'token-boost-radar', name: 'Token Boost Radar', tier: 'DEX Alpha' },
  { id: 'holder-concentration-analyzer', name: 'Holder Concentration Analyzer', tier: 'Risk Audit' },
  { id: 'smart-money-copy-scanner', name: 'Smart-Money Copy Scanner', tier: 'Whale Intel' },
  { id: 'jito-bundle-dispatcher', name: 'Jito Bundle Dispatcher', tier: 'MEV & Gas' },
  { id: 'multi-wallet-jito-injector', name: 'Multi-Wallet Jito Injector', tier: 'MEV & Gas' },
  { id: 'solana-sniper-daemon', name: 'Solana Sniper Daemon', tier: 'Execution' },
  { id: 'mev-arbitrage-bot', name: 'MEV Arbitrage Bot', tier: 'DEX Alpha' },
  { id: 'flash-loan-arbitrage', name: 'Flash Loan Arbitrage', tier: 'DEX Alpha' },
  { id: 'cross-dex-router', name: 'Cross-DEX Router', tier: 'DEX Alpha' },
  { id: 'raydium-swap-automator', name: 'Raydium Swap Automator', tier: 'Execution' },
  { id: 'pump-fun-bonding-curve', name: 'Pump.fun Bonding Curve', tier: 'DEX Alpha' },
  { id: 'limit-order-sniper', name: 'Limit Order Sniper', tier: 'Execution' },
  { id: 'orca-whirlpool-scanner', name: 'Orca Whirlpool Scanner', tier: 'DEX Alpha' },
  { id: 'meteora-dlmm-yield-finder', name: 'Meteora DLMM Yield Finder', tier: 'DEX Alpha' },
  { id: 'solana-tps-health-monitor', name: 'Solana TPS Health Monitor', tier: 'MEV & Gas' },
  { id: 'validator-stake-tracker', name: 'Validator Stake Tracker', tier: 'Whale Intel' },
  { id: 'spl-token-metadata-resolver', name: 'SPL Metadata Resolver', tier: 'Risk Audit' },
  { id: 'dex-volume-surge-detector', name: 'DEX Volume Surge Detector', tier: 'DEX Alpha' },
  { id: 'sol-usdc-spread-scanner', name: 'SOL/USDC Spread Scanner', tier: 'DEX Alpha' },
];

export default function BotInventoryStore() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const treasuryAddress = (import.meta.env.VITE_TREASURY_ADDRESS as string)?.trim() || '';
  const amountUsdc = parseFloat((import.meta.env.VITE_PAYMENT_AMOUNT_USDC as string) || '0.10');
  const callsPerPayment = Number((import.meta.env.VITE_API_CALLS_PER_PAYMENT as string) || '10');
  const baseUnits = BigInt(Math.round(amountUsdc * 1_000_000));

  const unlockLibrary = useCallback(
    async (libraryId: string) => {
      if (!publicKey) {
        setError('Connect your Solana wallet first to unlock an engine.');
        return;
      }
      if (!treasuryAddress) {
        setError('Treasury USDC address is not configured.');
        return;
      }
      if (activeId) return;

      setActiveId(libraryId);
      setError(null);

      try {
        const botTrapInput = (document.getElementById('bot-trap-field') as HTMLInputElement)?.value;
        if (botTrapInput && botTrapInput.trim() !== '') {
          throw new Error('Automated bot trap triggered. Request blocked.');
        }

        const recipientOwner = new PublicKey(treasuryAddress);
        const senderAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, publicKey);
        const recipientAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, recipientOwner, true);

        const transaction = new Transaction();
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.feePayer = publicKey;

        transaction.add(
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            recipientAta,
            recipientOwner,
            SOLANA_USDC_MINT
          ),
          createTransferInstruction(senderAta, recipientAta, publicKey, baseUnits)
        );

        const signature = await sendTransaction(transaction, connection);
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        );

        const res = await fetch('/api/paywall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signature,
            wallet: publicKey.toBase58(),
            libraryId,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to verify Solana USDC payment');
        }

        setUnlocked((prev) => ({ ...prev, [libraryId]: Number(data.credits || callsPerPayment) }));
      } catch (err: any) {
        setError(err?.message || 'Solana USDC payment failed.');
      } finally {
        setActiveId(null);
      }
    },
    [publicKey, treasuryAddress, activeId, connection, baseUnits, sendTransaction, callsPerPayment]
  );

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <Cpu className="w-5 h-5 text-indigo-400" />
          <div>
            <h3 className="text-lg font-bold text-white">24 Live Solana Mainnet Engines (SPL USDC)</h3>
            <p className="text-xs text-slate-400">Direct on-chain RPC, risk audit, MEV & DEX execution endpoints</p>
          </div>
        </div>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-800/50">
          {amountUsdc} USDC / {callsPerPayment} Calls
        </span>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {BOT_LIBRARIES.map((lib) => {
          const credits = unlocked[lib.id] || 0;
          const isProcessing = activeId === lib.id;
          return (
            <div
              key={lib.id}
              className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 flex flex-col justify-between gap-3"
            >
              <div>
                <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">
                  {lib.tier}
                </span>
                <h4 className="text-sm font-bold text-white mt-0.5">{lib.name}</h4>
                <p className="text-[11px] font-mono text-slate-400 mt-1">{lib.id}</p>
              </div>

              {credits > 0 ? (
                <div className="flex items-center justify-between text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 px-3 py-2 rounded-lg">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Unlocked
                  </span>
                  <span className="font-mono">{credits} calls</span>
                </div>
              ) : (
                <button
                  onClick={() => unlockLibrary(lib.id)}
                  disabled={Boolean(activeId)}
                  className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Confirming USDC...</span>
                    </>
                  ) : (
                    <>
                      {publicKey ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>Unlock ({amountUsdc} USDC)</span>
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
