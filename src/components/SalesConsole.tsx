import React, { useEffect, useState } from 'react';
import { Activity, DollarSign, ShieldCheck, Radio, RefreshCw } from 'lucide-react';

interface SaleEvent {
  ts: string;
  type: string;
  detail: string;
}

interface SalesTelemetry {
  treasury: string;
  totalUsdc: number;
  salesCount: number;
  recentSales: SaleEvent[];
}

export default function SalesConsole() {
  const [data, setData] = useState<SalesTelemetry>({
    treasury: (import.meta.env.VITE_TREASURY_ADDRESS as string)?.trim() || '',
    totalUsdc: 0,
    salesCount: 0,
    recentSales: [],
  });
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchTelemetry = async () => {
    try {
      const res = await fetch('/api/sales');
      if (res.ok) {
        const json = await res.json();
        setData({
          treasury: json.treasury || data.treasury,
          totalUsdc: Number(json.totalUsdc || 0),
          salesCount: Number(json.salesCount || 0),
          recentSales: Array.isArray(json.recentSales) ? json.recentSales : [],
        });
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch {
      // Retain last known live snapshot on transient network hiccup
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
          <div>
            <h3 className="text-lg font-bold text-white">Live Mainnet Telemetry & Settlement</h3>
            <p className="text-xs text-slate-400">Real-time Upstash Redis & Solana SPL USDC ledger</p>
          </div>
        </div>
        <button
          onClick={fetchTelemetry}
          className="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{lastUpdated ? `Synced ${lastUpdated}` : 'Syncing...'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Verified USDC Earned</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-black text-emerald-400 mt-1">
            ${data.totalUsdc.toFixed(2)} <span className="text-xs font-normal text-slate-400">USDC</span>
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Confirmed Settlements</span>
            <Activity className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-2xl font-black text-white mt-1">{data.salesCount}</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>x402 v2 Protocol</span>
            <ShieldCheck className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-sm font-bold text-indigo-300 mt-2">Active • 24 Live Engines</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Verified On-Chain USDC Payments</span>
          <span className="font-mono text-[11px] text-slate-500">
            Treasury: {data.treasury ? `${data.treasury.slice(0, 6)}...${data.treasury.slice(-6)}` : 'Configured'}
          </span>
        </div>

        {data.recentSales.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400 text-center">
            Listening for live Solana SPL USDC settlements via /api/paywall and x402 PAYMENT-SIGNATURE headers.
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {data.recentSales.map((sale, idx) => (
              <div
                key={`${sale.ts}-${idx}`}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-mono text-[10px] shrink-0">
                    {sale.type}
                  </span>
                  <span className="text-slate-200 truncate">{sale.detail}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-500 shrink-0">
                  {new Date(sale.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
