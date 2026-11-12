import { useEffect, useState } from 'react';

interface TelemetryItem {
    id: string;
    text: string;
    time: string;
}

export default function LiveTicker() {
    const [telemetry, setTelemetry] = useState<TelemetryItem[]>([
        { id: '1', text: '0.1 SOL received from 7xKX...3v9N [Solana Sniper Daemon v4 - 60 Calls]', time: 'Just now' },
        { id: '2', text: 'Payout sweep executed to 2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym', time: '1m ago' },
        { id: '3', text: '0.1 SOL received from 9mQ2...1w8R [Jito Bundle Dispatcher - 60 Calls]', time: '3m ago' }
    ]);

    useEffect(() => {
        const interval = setInterval(() => {
            fetch('/api/payout')
                .then(res => res.json())
                .then(data => {
                    if (data && data.success) {
                        const newItem: TelemetryItem = {
                            id: Date.now().toString(),
                            text: `Telemetry sync: Payout routed to ${data.targetAddress.slice(0, 6)}...`,
                            time: 'Just now'
                        };
                        setTelemetry(prev => [newItem, ...prev.slice(0, 5)]);
                    }
                })
                .catch(() => {});
        }, 10000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full bg-black border-y border-slate-900 py-3 overflow-hidden font-mono text-xs text-indigo-400">
            <div className="flex space-x-8 animate-marquee whitespace-nowrap">
                {telemetry.map(item => (
                    <div key={item.id} className="flex items-center space-x-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>{item.text}</span>
                        <span className="text-slate-600">({item.time})</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
