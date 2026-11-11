import React, { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { ConfirmedSignatureInfo } from '@solana/web3.js';
import { History, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

export default function TransactionHistory() {
    const { connection } = useConnection();
    const { publicKey } = useWallet();
    const [signatures, setSignatures] = useState<ConfirmedSignatureInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchHistory = async () => {
        if (!publicKey) return;
        setLoading(true);
        setError(null);
        try {
            const sigs = await connection.getSignaturesForAddress(publicKey, { limit: 10 });
            setSignatures(sigs);
        } catch (err: any) {
            console.error('Failed to fetch transaction history:', err);
            setError(err.message || 'Failed to fetch transaction history');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, [publicKey, connection]);

    if (!publicKey) {
        return (
            <div className="p-6 bg-slate-900/80 border border-slate-800 rounded-xl text-center text-slate-400 mt-6">
                <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Connect your wallet to view recent paywall transaction history on Solana.</p>
            </div>
        );
    }

    return (
        <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl mt-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                    <History className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-lg font-semibold text-white">Recent Solana Paywall Transactions</h3>
                </div>
                <button
                    onClick={fetchHistory}
                    disabled={loading}
                    className="p-2 text-slate-400 hover:text-white transition rounded-lg hover:bg-slate-800"
                    title="Refresh history"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && (
                <div className="p-3 mb-4 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
                    {error}
                </div>
            )}

            {loading && signatures.length === 0 ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
            ) : signatures.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No recent transactions found for this wallet.</p>
            ) : (
                <div className="space-y-3">
                    {signatures.map((sig) => {
                        const shortSig = `${sig.signature.slice(0, 8)}...${sig.signature.slice(-8)}`;
                        const blockTimeNum = sig.blockTime as unknown as number | null;
                        const dateStr = blockTimeNum ? new Date(blockTimeNum * 1000).toLocaleString() : 'Recent';
                        const isSuccess = !sig.err;

                        return (
                            <div
                                key={sig.signature}
                                className="flex items-center justify-between p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl hover:bg-slate-800 transition"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center space-x-2">
                                        <span className={`w-2 h-2 rounded-full ${isSuccess ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                        <span className="font-mono text-sm text-slate-200">{shortSig}</span>
                                    </div>
                                    <p className="text-xs text-slate-400">{dateStr} • Slot: {sig.slot}</p>
                                </div>
                                <div className="flex items-center space-x-3">
                                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${isSuccess ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50' : 'bg-red-950 text-red-300 border border-red-800/50'}`}>
                                        {isSuccess ? 'Success' : 'Failed'}
                                    </span>
                                    <a
                                        href={`https://explorer.solana.com/tx/${sig.signature}?cluster=mainnet-beta`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 text-slate-400 hover:text-indigo-400 transition rounded-lg hover:bg-slate-700"
                                        title="View on Solana Explorer"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
