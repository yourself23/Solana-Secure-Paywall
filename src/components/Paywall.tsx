import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createPaymentProof } from '../payment-proof';

export default function Paywall() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const [config, setConfig] = useState<{ treasury: string; amountSol: number; lamports: number; prepaidAvailable: boolean } | null>(null);
  const [pending, setPending] = useState<{ signature: string; wallet: string } | null>(() => {
    const saved = sessionStorage.getItem('pending-sol-payment');
    return saved ? JSON.parse(saved) : null;
  });
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/sales').then(async (res) => {
      if (!res.ok) throw new Error('Payment configuration unavailable');
      setConfig(await res.json());
    }).catch((error: Error) => setStatus(error.message));
  }, []);

  const pay = async () => {
    if (!publicKey || !signMessage || !config?.prepaidAvailable) return setStatus('Connect a wallet with message signing and configure prepaid payments.');
    if (pending && pending.wallet !== publicKey.toBase58()) return setStatus('Reconnect the wallet that made the pending payment.');
    setLoading(true);
    try {
      let signature = pending?.signature;
      if (!signature) {
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(config.treasury), lamports: config.lamports }));
        signature = await sendTransaction(tx, connection);
        const payment = { signature, wallet: publicKey.toBase58() };
        sessionStorage.setItem('pending-sol-payment', JSON.stringify(payment));
        setPending(payment);
      }
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        sessionStorage.removeItem('pending-sol-payment');
        setPending(null);
        throw new Error('Payment transaction failed on chain.');
      }
      const walletProof = await createPaymentProof(signature, signMessage);
      const response = await fetch('/api/paywall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature, wallet: publicKey.toBase58(), walletProof }) });
      const result = await response.json();
      if (!response.ok || !result.apiKey) throw new Error(result.error || 'Payment verification failed');
      sessionStorage.removeItem('pending-sol-payment');
      setPending(null);
      setApiKey(result.apiKey);
      setStatus(`${result.credits} calls available.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 rounded-xl p-4 space-y-3">
      <h2 className="text-white font-bold">Native SOL prepaid pass</h2>
      <p className="text-sm text-slate-300">{config ? `${config.amountSol} SOL to ${config.treasury}` : 'Payment configuration unavailable'}</p>
      <WalletMultiButton />
      <button onClick={pay} disabled={loading || !config?.prepaidAvailable} className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50">
        {loading ? 'Confirming...' : pending ? 'Retry payment redemption' : 'Buy 10-call pass'}
      </button>
      {status && <p className="text-sm text-slate-300">{status}</p>}
      {apiKey && <p className="text-sm text-emerald-300 break-all">x-api-key: {apiKey}</p>}
    </div>
  );
}
