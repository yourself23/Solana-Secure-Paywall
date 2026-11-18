import { useEffect, useState } from 'react';

export default function SalesConsole() {
  const [config, setConfig] = useState<{ treasury: string; availableEngines: string[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/sales').then(async (response) => {
      if (!response.ok) throw new Error('Payment configuration unavailable');
      setConfig(await response.json());
    }).catch((reason: Error) => setError(reason.message));
  }, []);
  return (
    <div className="bg-slate-900 rounded-xl p-4 space-y-2">
      <h3 className="font-bold text-white">Solana payment configuration</h3>
      {error && <p className="text-rose-300">{error}</p>}
      {config && <p className="text-sm text-slate-300 break-all">Treasury: {config.treasury} · {config.availableEngines.length} available engines</p>}
      <p className="text-xs text-slate-400">Payment telemetry is available only through the authenticated telemetry endpoint.</p>
    </div>
  );
}
