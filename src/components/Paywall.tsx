import React, { useCallback, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Transaction, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import { ShieldAlert, Lock, CheckCircle2, Loader2, Zap, Fuel } from 'lucide-react';

const SOLANA_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export default function Paywall() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [successSig, setSuccessSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const treasuryAddress = (import.meta.env.VITE_TREASURY_ADDRESS as string)?.trim() || '';
  const amountUsdc = parseFloat((import.meta.env.VITE_PAYMENT_AMOUNT_USDC as string) || '10');
  const baseUnits = BigInt(Math.round(amountUsdc * 1_000_000));

  const onPay = useCallback(async () => {
    if (!publicKey || loading) return;
    if (!treasuryAddress) {
      setError('Paywall treasury address is not configured.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessSig(null);

    try {
      const botTrapInput = (document.getElementById('bot-trap-field') as HTMLInputElement)?.value;
      if (botTrapInput && botTrapInput.trim() !== '') {
        throw new Error('Bot trap triggered: Automated scraping detected. Request blocked.');
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
        createTransferInstruction(
          senderAta,
          recipientAta,
          publicKey,
          baseUnits
        )
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

      const verifyRes = await fetch('/api/paywall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          wallet: publicKey.toBase58(),
          libraryId: 'solana-sniper-daemon',
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'On-chain USDC verification failed');
      }

      setSuccessSig(signature);
    } catch (err: any) {
      setError(err?.message || 'USDC transaction failed or was rejected.');
    } finally {
      setLoading(false);
    }
  }, [publicKey, loading, treasuryAddress, baseUnits, connection, sendTransaction]);

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Solana USDC Botwall</h2>
              <p className="text-xs text-slate-400">Direct SPL USDC Settlement (60 API Credits)</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              {amountUsdc} USDC
            </span>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Solana SPL Token</p>
          </div>
        </div>

        <div className="hidden" aria-hidden="true">
          <label htmlFor="bot-trap-field">Do not fill this out if you are human</label>
          <input type="text" id="bot-trap-field" name="bot_trap_field" tabIndex={-1} autoComplete="off" />
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="flex items-center space-x-1.5 font-medium">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>USDC Deposit Recipient (Solana)</span>
              </span>
              <span className="inline-flex items-center space-x-1 text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
                <Fuel className="w-3 h-3" />
                <span>USDC Only</span>
              </span>
            </div>
            <div className="font-mono text-xs text-indigo-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 break-all select-all">
              {treasuryAddress || 'Treasury address not configured'}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <WalletMultiButton className="!w-full sm:!w-auto !justify-center !bg-slate-800 hover:!bg-slate-700 !rounded-xl !h-11 !text-sm" />
            {publicKey && (
              <button
                onClick={onPay}
                disabled={loading}
                className="w-full sm:flex-1 h-11 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying USDC Payment...</span>
                  </>
                ) : (
                  <span>Pay {amountUsdc} USDC & Unlock 60 Calls</span>
                )}
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {successSig && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <div className="break-all">
                <p className="font-semibold">USDC Payment Verified — 60 API Calls Credited!</p>
                <p className="font-mono text-[11px] text-emerald-400/80 mt-1">Tx: {successSig}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
