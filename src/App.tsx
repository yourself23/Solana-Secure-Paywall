import {ConnectionProvider, WalletProvider} from '@solana/wallet-adapter-react';
import {WalletModalProvider} from '@solana/wallet-adapter-react-ui';
import {PhantomWalletAdapter, SolflareWalletAdapter} from '@solana/wallet-adapter-wallets';
import {useMemo} from 'react';
import Paywall from './components/Paywall';
import TransactionHistory from './components/TransactionHistory';
import '@solana/wallet-adapter-react-ui/styles.css';
import { ShieldCheck, Cpu, ArrowUpRight, Zap } from 'lucide-react';

export default function App() {
    const wallets = useMemo(() => [
        new PhantomWalletAdapter(),
        new SolflareWalletAdapter()
    ], []);

    return (
        <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white pb-16">
                        {/* Header Navbar */}
                        <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
                            <div className="max-w-6xl mx-auto px-6 h-18 flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                                        <ShieldCheck className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h1 className="font-bold text-lg bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
                                            Solana Secure Paywall
                                        </h1>
                                        <p className="text-xs text-slate-400">Botwall & Digital Asset Store</p>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-800/50 text-emerald-300 text-xs font-medium">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                        <span>Solana Mainnet Active</span>
                                    </div>
                                </div>
                            </div>
                        </header>

                        {/* Main Content */}
                        <main className="max-w-6xl mx-auto px-6 pt-10">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* Left Column: Info & Stats */}
                                <div className="space-y-6">
                                    <div className="p-6 bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl space-y-4">
                                        <div className="flex items-center space-x-2 text-indigo-400">
                                            <Zap className="w-5 h-5" />
                                            <h2 className="font-semibold text-white">Protocol Status</h2>
                                        </div>
                                        <p className="text-sm text-slate-300 leading-relaxed">
                                            High-security cryptographic botwall and automated asset store running directly on the Solana blockchain. All transfers are 100% deliverable with automated 5-minute payout intervals.
                                        </p>
                                        <div className="pt-2 border-t border-slate-800 space-y-2 text-xs text-slate-400">
                                            <div className="flex justify-between">
                                                <span>Access Cost:</span>
                                                <span className="text-indigo-300 font-mono font-medium">0.1 SOL / Call</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Treasury Destination:</span>
                                                <span className="text-slate-200 font-mono truncate max-w-[160px]" title="2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym">
                                                    2AoLHz...M2yhym
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Payout Frequency:</span>
                                                <span className="text-emerald-400 font-medium">Every 5 Minutes</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-6 bg-gradient-to-br from-indigo-950/40 via-slate-900/80 to-purple-950/40 border border-indigo-900/40 rounded-2xl shadow-xl">
                                        <div className="flex items-center space-x-2 text-indigo-300 mb-2">
                                            <Cpu className="w-5 h-5" />
                                            <h3 className="font-semibold text-white">Smart Contract</h3>
                                        </div>
                                        <p className="text-xs text-slate-300 mb-4">
                                            Botwall program verified with automated bot-trap protection and SPL token transfer checks.
                                        </p>
                                        <a
                                            href="https://explorer.solana.com/address/89zS48g49d48fg948g948g948g948g498g948g9?cluster=mainnet-beta"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center space-x-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition"
                                        >
                                            <span>View Program on Explorer</span>
                                            <ArrowUpRight className="w-3.5 h-3.5" />
                                        </a>
                                    </div>
                                </div>

                                {/* Right 2 Columns: Paywall & History */}
                                <div className="lg:col-span-2 space-y-6">
                                    <Paywall />
                                    <TransactionHistory />
                                </div>
                            </div>
                        </main>
                    </div>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
