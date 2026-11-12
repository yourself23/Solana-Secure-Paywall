import React, {useCallback, useState} from 'react';
import {useConnection, useWallet} from '@solana/wallet-adapter-react';
import {WalletMultiButton} from '@solana/wallet-adapter-react-ui';
import {Transaction, PublicKey} from '@solana/web3.js';
import {createTransferInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID} from '@solana/spl-token';
import { ShieldAlert, Lock, CheckCircle2, Loader2, Zap, Terminal, Fuel } from 'lucide-react';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;
const PAYMENT_AMOUNT_USDC = 0.1;

export default function Paywall() {
    const {connection} = useConnection();
    const {publicKey, sendTransaction} = useWallet();
    const [loading, setLoading] = useState(false);
    const [successSig, setSuccessSig] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [honeypotTriggered, setHoneypotTriggered] = useState(false);

    const onPay = useCallback(async () => {
        if (!publicKey) return;
        setLoading(true);
        setError(null);
        setSuccessSig(null);

        try {
            // Check honeypot / bot trap validation
            const botTrapInput = (document.getElementById('bot-trap-field') as HTMLInputElement)?.value;
            if (botTrapInput && botTrapInput.trim() !== '') {
                setHoneypotTriggered(true);
                throw new Error('Bot trap triggered: Automated scraping detected. Request blocked.');
            }

            const targetAddress = new PublicKey('2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym');

            // Compute associated token accounts for USDC
            const userAta = getAssociatedTokenAddressSync(USDC_MINT, publicKey, false);
            const recipientAta = getAssociatedTokenAddressSync(USDC_MINT, targetAddress, false);

            const transaction = new Transaction();

            // Recent blockhash
            const latestBlockhash = await connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = publicKey;

            // Ensure recipient has an associated token account for USDC (create if missing)
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    publicKey,        // payer
                    recipientAta,     // associated token account to create
                    targetAddress,    // owner
                    USDC_MINT         // mint
                )
            );

            // Transfer 0.1 USDC (6 decimals) from buyer to recipient
            const amount = Math.floor(PAYMENT_AMOUNT_USDC * Math.pow(10, USDC_DECIMALS));
            transaction.add(
                createTransferInstruction(
                    userAta,          // source
                    recipientAta,     // destination
                    publicKey,        // owner
                    amount,           // amount with decimals
                    [],
                    TOKEN_PROGRAM_ID
                )
            );

            const signature = await sendTransaction(transaction, connection);
            setSuccessSig(signature);
        } catch (err: any) {
            console.error('Payment error:', err);
            setError(err.message || 'Transaction failed or rejected by user.');
        } finally {
            setLoading(false);
        }
    }, [publicKey, sendTransaction, connection]);

    return (
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 space-y-6">
<div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <Lock className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">Solana Botwall Paywall</h2>
                        <p className="text-xs text-slate-400">Gas-Covered Zero-Fee Recipient Settlement</p>
                    </div>
                </div>
                <div className="text-right">
                    <span className="text-2xl font-black bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
                        0.1 USDC
                    </span>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Exact Net Delivery</p>
                </div>
            </div>

                {/* Hidden Honeypot Field (Bot Trap) */}
                <div className="hidden" aria-hidden="true">
                    <label htmlFor="bot-trap-field">Do not fill this out if you are human</label>
                    <input type="text" id="bot-trap-field" name="bot_trap_field" tabIndex={-1} autoComplete="off" />
                </div>

                <div className="space-y-4">
                    <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-300">
                            <span className="flex items-center space-x-1.5 font-medium">
                                <Zap className="w-3.5 h-3.5 text-amber-400" />
                                <span>Deposit Recipient Address</span>
                            </span>
                            <span className="inline-flex items-center space-x-1 text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
                                <Fuel className="w-3 h-3" />
                                <span>Gas Covered From Sales</span>
                            </span>
                        </div>
                        <div className="font-mono text-xs text-indigo-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 break-all select-all">
                            2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                        <div className="w-full sm:w-auto">
                            <WalletMultiButton className="!bg-indigo-600 hover:!bg-indigo-500 !transition !rounded-xl !font-medium !text-sm !shadow-lg !shadow-indigo-600/30" />
                        </div>

                        {publicKey && (
                            <button
                                onClick={onPay}
                                disabled={loading}
                                className="w-full sm:w-auto flex-1 inline-flex items-center justify-center space-x-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium py-3 px-6 rounded-xl shadow-lg shadow-indigo-600/30 transition disabled:opacity-50 cursor-pointer"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span>Processing Settlement...</span>
                                    </>
                                ) : (
                                    <>
                                        <Terminal className="w-5 h-5" />
                                        <span>Pay 0.1 USDC (Gas Covered)</span>
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-sm flex items-start space-x-3">
                        <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">Access Restriction</p>
                            <p className="text-xs text-red-200 mt-0.5">{error}</p>
                        </div>
                    </div>
                )}

                {successSig && (
                    <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-emerald-300 text-sm flex items-start space-x-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div className="space-y-1">
                            <p className="font-semibold text-white">Payment Confirmed & Fully Delivered!</p>
                            <p className="text-xs text-slate-300 font-mono break-all">Signature: {successSig}</p>
                            <a
                                href={`https://explorer.solana.com/tx/${successSig}?cluster=mainnet-beta`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block text-xs text-indigo-400 hover:text-indigo-300 underline pt-1 font-medium"
                            >
                                View on Solana Explorer →
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
