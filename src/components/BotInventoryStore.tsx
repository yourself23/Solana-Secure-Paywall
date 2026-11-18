import { useEffect, useState } from 'react';
import Paywall from './Paywall';

export default function BotInventoryStore() {
  const [engines, setEngines] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/sales').then(async (response) => {
      if (!response.ok) throw new Error('Engine catalogue unavailable');
      const data = await response.json();
      setEngines(data.availableEngines);
    }).catch((reason: Error) => setError(reason.message));
  }, []);
  return (
    <div className="space-y-4">
      <Paywall />
      <h3 className="text-lg font-bold text-white">Available Solana engines</h3>
      {error && <p className="text-rose-300">{error}</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {engines.map((engine) => <div key={engine} className="rounded bg-slate-800 p-3 text-sm text-slate-200">{engine}</div>)}
      </div>
    </div>
  );
}
