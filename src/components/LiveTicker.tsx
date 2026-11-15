import { useEffect, useState } from 'react';

interface Sale {
    signature: string;
    sender: string | null;
    amountUsdc: number;
}

export default function LiveTicker() {
    const [sales, setSales] = useState<Sale[]>([]);

    useEffect(() => {
        const load = () =>
            fetch('/api/sales')
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => data && setSales(data.sales.slice(0, 6)))
                .catch(() => {});
        load();
        const interval = setInterval(load, 30000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full bg-black border-y border-slate-900 py-3 overflow-hidden font-mono text-xs text-indigo-400">
            <div className="flex space-x-8 animate-marquee whitespace-nowrap">
                {sales.length === 0 && <span className="text-slate-600">Waiting for on-chain payments…</span>}
                {sales.map((item) => (
                    <div key={item.signature} className="flex items-center space-x-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>
                            {item.amountUsdc} USDC received{item.sender ? ` from ${item.sender.slice(0, 4)}...${item.sender.slice(-4)}` : ''}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
