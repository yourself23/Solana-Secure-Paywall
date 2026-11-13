import { useEffect, useState } from 'react';

const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS || '2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym';
const PAYMENT_AMOUNT_SOL = parseFloat(import.meta.env.VITE_PAYMENT_AMOUNT_SOL || '0.1');
const CALLS_PER_PAYMENT = parseInt(import.meta.env.VITE_API_CALLS_PER_PAYMENT || '60', 10);

interface TelemetryItem {
    id: string;
    text: string;
    time: string;
}

export default function LiveTicker() {
    const [telemetry, setTelemetry] = useState<TelemetryItem[]>([
        { id: '1', text: `${PAYMENT_AMOUNT_SOL} SOL received from 7xKX...3v9N [Solana Sniper Daemon v4 - ${CALLS_PER_PAYMENT} Calls]`, time: 'Just now' },
        { id: '2', text: `Payout sweep executed to ${TREASURY_ADDRESS.slice(0, 6)}...${TREASURY_ADDRESS.slice(-6)}`, time: '1m ago' },
        { id: '3', text: `${PAYMENT_AMOUNT_SOL} SOL received from 9mQ2...1w8R [Jito Bundle Dispatcher - ${CALLS_PER_PAYMENT} Calls]`, time: '3m ago' }
    ]);

    useEffect(() => {
        // Simulated telemetry updates - in production, this would connect to a WebSocket or SSE endpoint
        const interval = setInterval(() => {
            const mockUpdates = [
                `${PAYMENT_AMOUNT_SOL} SOL received from ${Math.random().toString(36).substring(2, 6)}...${Math.random().toString(36).substring(2, 6)} [Solana Sniper Daemon v4 - ${CALLS_PER_PAYMENT} Calls]`,
                `Payout sweep executed to ${TREASURY_ADDRESS.slice(0, 6)}...${TREASURY_ADDRESS.slice(-6)}`,
                `${PAYMENT_AMOUNT_SOL} SOL received from ${Math.random().toString(36).substring(2, 6)}...${Math.random().toString(36).substring(2, 6)} [Jito Bundle Dispatcher - ${CALLS_PER_PAYMENT} Calls]`
            ];
            const randomUpdate = mockUpdates[Math.floor(Math.random() * mockUpdates.length)] ?? 'Telemetry update';
            
            const newItem: TelemetryItem = {
                id: Date.now().toString(),
                text: randomUpdate,
                time: 'Just now'
            };
            setTelemetry(prev => [newItem, ...prev.slice(0, 5)]);
        }, 15000);

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