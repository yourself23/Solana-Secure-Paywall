import { useEffect, useState } from 'react';
import { Activity, RefreshCcw, ExternalLink, Cpu, Users, DollarSign, BarChart3, Zap } from 'lucide-react';

interface Sale {
    signature: string;
    blockTime: number | null;
    slot: number;
    sender: string | null;
    amountUsdc: number;
}

const short = (v: string) => `${v.slice(0, 4)}...${v.slice(-4)}`;

export default function SalesConsole() {
    const [sales, setSales] = useState<Sale[]>([]);
    const [totalRevenue, setTotalRevenue] = useState(0);
    const [callsPerPayment, setCallsPerPayment] = useState(10);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastPolled, setLastPolled] = useState<string>('never');

    const fetchTelemetry = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/sales');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load sales');
            setSales(data.sales);
            setTotalRevenue(data.totalUsdc);
            setCallsPerPayment(data.callsPerPayment);
            setError(null);
            setLastPolled(new Date().toLocaleTimeString());
        } catch (err: any) {
            setError(err?.message || 'Failed to load on-chain sales');
        } finally {
            setLoading(false);
        }
    };

    const totalCallsSold = sales.length * callsPerPayment;
    const uniqueBuyers = new Set(sales.map((x) => x.sender).filter(Boolean)).size;
    const latest = sales[0];

    useEffect(() => {
        fetchTelemetry();
        // Polling mechanism every 30 seconds to fetch latest on-chain transaction logs
        const interval = setInterval(fetchTelemetry, 30000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full max-w-7xl mx-auto space-y-6">
            {/* Top Header & Console Status */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                        <Activity className="w-6 h-6 text-white animate-pulse" />
                    </div>
                    <div>
                        <div className="flex items-center space-x-2">
                            <h2 className="text-xl font-black text-white tracking-tight">Botwall Sales & Telemetry Console</h2>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 text-[10px] font-mono">
                                LIVE ON-CHAIN
                            </span>
                        </div>
                        <p className="text-xs text-slate-400">USDC deposits read live from the Solana blockchain.</p>
                    </div>
                </div>

                <div className="flex items-center space-x-4">
                    <span className="text-[11px] font-mono text-slate-400">
                        Last Polled: <strong className="text-indigo-300">{lastPolled}</strong> (30s interval)
                    </span>
                    <button
                        onClick={fetchTelemetry}
                        disabled={loading}
                        className="inline-flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-medium transition cursor-pointer"
                    >
                        <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        <span>Refresh Now</span>
                    </button>
                </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-mono uppercase">Total Revenue</span>
                        <DollarSign className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-2xl font-black text-white font-mono">{totalRevenue.toFixed(2)} USDC</div>
                    <p className="text-[10px] text-emerald-400 flex items-center space-x-1">
                        <span>Last {sales.length} on-chain deposits</span>
                    </p>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-mono uppercase">API Calls Sold</span>
                        <Cpu className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div className="text-2xl font-black text-white font-mono">{totalCallsSold} Calls</div>
                    <p className="text-[10px] text-slate-400">{callsPerPayment} calls per payment</p>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-mono uppercase">Unique Buyers</span>
                        <Users className="w-4 h-4 text-violet-400" />
                    </div>
                    <div className="text-2xl font-black text-white font-mono">{uniqueBuyers} Wallets</div>
                    <p className="text-[10px] text-violet-400">Distinct paying wallets</p>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-mono uppercase">Latest Payment</span>
                        <Zap className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="text-2xl font-black text-emerald-400 font-mono">{latest ? `${latest.amountUsdc} USDC` : 'None yet'}</div>
                    <p className="text-[10px] text-slate-400">{latest?.blockTime ? new Date(latest.blockTime * 1000).toLocaleString() : 'Waiting for first payment'}</p>
                </div>
            </div>

            {/* Analytics Breakdown: What's Selling & Who's Buying */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Top buyers */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center space-x-2 text-white font-bold">
                        <BarChart3 className="w-5 h-5 text-indigo-400" />
                        <h3>Top Buyers</h3>
                    </div>
                    <div className="space-y-2 text-xs font-mono">
                        {Object.entries(sales.reduce<Record<string, number>>((m, x) => {
                            if (x.sender) m[x.sender] = (m[x.sender] || 0) + x.amountUsdc;
                            return m;
                        }, {})).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([w, amt]) => (
                            <div key={w} className="flex justify-between">
                                <span className="text-slate-300">{short(w)}</span>
                                <span className="text-indigo-400 font-bold">{amt.toFixed(2)} USDC</span>
                            </div>
                        ))}
                        {sales.length === 0 && <span className="text-slate-500">No payments yet</span>}
                    </div>
                </div>

                {/* Who's Buying (Live Buyer Feed) */}
                <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-white font-bold">
                            <Users className="w-5 h-5 text-emerald-400" />
                            <h3>Recent On-Chain Payments</h3>
                        </div>
                        <span className="text-xs font-mono text-slate-400">Polling every 30s</span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="text-xs uppercase text-slate-400 bg-slate-800/60 border-b border-slate-700">
                                <tr>
                                    <th className="px-4 py-3">Time</th>
                                                                        <th className="px-4 py-3">Payer</th>
                                    <th className="px-4 py-3">Calls</th>
                                    <th className="px-4 py-3">Amount</th>
                                    <th className="px-4 py-3 text-right">Explorer</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 font-mono text-xs">
                                {sales.slice(0, 6).map((sale) => (
                                    <tr key={sale.signature} className="hover:bg-slate-800/40 transition">
                                        <td className="px-4 py-3 text-slate-400">{sale.blockTime ? new Date(sale.blockTime * 1000).toLocaleString() : '-'}</td>
                                        <td className="px-4 py-3 text-indigo-300">{sale.sender ? short(sale.sender) : 'unknown'}</td>
                                        <td className="px-4 py-3 text-emerald-400 font-bold">+{callsPerPayment}</td>
                                        <td className="px-4 py-3 text-white">{sale.amountUsdc} USDC</td>
                                        <td className="px-4 py-3 text-right">
                                            <a
                                                href={`https://explorer.solana.com/tx/${sale.signature}?cluster=mainnet-beta`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 transition"
                                            >
                                                <span>Tx</span>
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                                {sales.length === 0 && (
                                    <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">{error || 'No payments received yet'}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
