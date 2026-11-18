import React, { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createPaymentProof } from './payment-proof';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

const ENDPOINTS = [
  { tier: 'RPC & PRICE (90,000 lamports)', price: '0.00009 SOL', method: 'POST', path: '/api/rpc/solana', desc: 'Safelisted Solana Mainnet JSON-RPC proxy' },
  { tier: 'RPC & PRICE (90,000 lamports)', price: '0.00009 SOL', method: 'GET', path: '/api/rpc/blockhash', desc: 'Latest Solana Mainnet blockhash' },
  { tier: 'RPC & PRICE (90,000 lamports)', price: '0.00009 SOL', method: 'GET', path: '/api/rpc/price', desc: 'Real-time SPL token USD price & pair feed' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/whales', desc: 'Top circulating whale wallets & balance audit' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/rug-check', desc: 'SPL mint authority, freeze authority & largest token accounts for a supplied mint' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/fees', desc: 'Live priority fee oracle (standard / turbo / urgent microLamports)' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/pools', desc: 'DexScreener pools for a supplied token mint' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/boosts', desc: 'Boosted Solana token radar from DexScreener' },
  { tier: 'GPU CLOUD (130,000 lamports)', price: '0.00013 SOL', method: 'GET', path: '/api/solana/gpu-rates', desc: 'Live cloud GPU rental hourly rates & availability (H100, A100, 4090)' },
  { tier: 'ENGINE', price: 'See quote', method: 'POST', path: '/api/v1/invoke', desc: 'Solana analytics and unsigned Jupiter swap plans' },
];

export default function App() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const [copied, setCopied] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<{ treasury: string; amountSol: number; lamports: number; prepaidAvailable: boolean } | null>(null);
  const [pending, setPending] = useState<{ signature: string; wallet: string } | null>(() => {
    const saved = sessionStorage.getItem('pending-sol-payment');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    fetch('/api/sales').then(async (response) => {
      if (!response.ok) throw new Error('Payment configuration unavailable');
      setConfig(await response.json());
    }).catch((error: Error) => setStatus(error.message));
  }, []);

  const copyText = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  };

  const mintPrepaidPass = async () => {
    if (!publicKey) return setStatus('Connect a Solana wallet first.');
    if (!signMessage) return setStatus('Your wallet must support message signing.');
    if (!config?.prepaidAvailable) return setStatus('Prepaid payment is not configured.');
    if (pending && pending.wallet !== publicKey.toBase58()) return setStatus('Reconnect the wallet that made the pending payment.');
    try {
      setLoading(true);
      let sig = pending?.signature;
      if (!sig) {
        setStatus(`Requesting ${config.amountSol} SOL signature...`);
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(config.treasury), lamports: config.lamports }));
        sig = await sendTransaction(tx, connection);
        const payment = { signature: sig, wallet: publicKey.toBase58() };
        sessionStorage.setItem('pending-sol-payment', JSON.stringify(payment));
        setPending(payment);
      }
      setStatus(`Confirming ${sig.slice(0, 10)}...`);
      const confirmation = await connection.confirmTransaction(sig, 'confirmed');
      if (confirmation.value.err) {
        sessionStorage.removeItem('pending-sol-payment');
        setPending(null);
        throw new Error('Payment transaction failed on chain.');
      }
      const walletProof = await createPaymentProof(sig, signMessage);
      const r = await fetch('/api/paywall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig, wallet: publicKey.toBase58(), walletProof }) });
      const data = await r.json();
      if (r.ok && data.apiKey) {
        sessionStorage.removeItem('pending-sol-payment');
        setPending(null);
        setApiKey(data.apiKey);
        setStatus(`${data.credits}-Call Agent Pass Issued.`);
      }
      else setStatus(data.error || 'Verification pending.');
    } catch (e: any) { setStatus(e?.message || 'Cancelled'); } finally { setLoading(false); }
  };

  const curlSnippet = `curl -i "${BASE_URL}/api/solana/fees"`;
  const mcpSnippet = JSON.stringify({ mcpServers: { solanaPaywall: { url: `${BASE_URL}/api/mcp` } } }, null, 2);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-mono p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="border border-emerald-500/30 bg-slate-900 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="text-xs text-emerald-400 uppercase tracking-widest">Solana Mainnet • Native SOL passes • Wrapped SOL x402</div>
            <h1 className="text-xl md:text-2xl font-bold text-white mt-1">Solana Agent Execution & RPC Gateway</h1>
            <p className="text-xs text-slate-400 mt-1">Prepaid API keys and HTTP 402 payments • OpenAPI & Remote MCP</p>
          </div>
          <WalletMultiButton />
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-slate-800 bg-slate-900 rounded-xl p-4 space-y-2">
            <div className="text-xs text-slate-400 uppercase">Native SOL Treasury (payTo)</div>
            <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-emerald-300 break-all">
              <span>{config?.treasury || 'Payment configuration unavailable'}</span>
              {config && <button onClick={() => copyText('treasury', config.treasury)} className="shrink-0 px-2 py-1 bg-slate-800 rounded text-white">{copied === 'treasury' ? 'Copied' : 'Copy'}</button>}
            </div>
            <div className="flex flex-wrap gap-2 pt-1 text-xs">
              <a href="/openapi.json" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-cyan-300">/openapi.json</a>
              <a href="/.well-known/x402.json" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-cyan-300">/.well-known/x402.json</a>
              <a href="/.well-known/agent.json" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-cyan-300">/.well-known/agent.json</a>
              <a href="/api/mcp" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-emerald-300">/api/mcp</a>
            </div>
          </div>

          <div className="border border-slate-800 bg-slate-900 rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div>
              <div className="text-xs text-slate-400 uppercase">Prepaid Bot Pass (10 Calls)</div>
              <p className="text-xs text-slate-300 mt-1">Send <span className="text-emerald-400 font-bold">{config ? `${config.amountSol} SOL` : 'SOL'}</span> to receive an <code className="text-cyan-300">x-api-key</code> for /api/v1/invoke.</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={mintPrepaidPass} disabled={loading || !config?.prepaidAvailable} className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs disabled:opacity-50">{loading ? 'Confirming...' : pending ? 'Retry payment redemption' : 'Mint 10-Call Pass'}</button>
              {status && <span className="text-xs text-amber-300">{status}</span>}
            </div>
            {apiKey && <div className="bg-slate-950 border border-emerald-500/40 rounded px-3 py-2 text-xs text-emerald-300 flex justify-between"><span>x-api-key: {apiKey}</span><button onClick={() => copyText('key', apiKey)} className="px-2 bg-slate-800 rounded text-white">{copied === 'key' ? 'Copied' : 'Copy'}</button></div>}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-slate-800 bg-slate-900 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-xs"><span className="text-slate-400 uppercase">1. x402 Probe (cURL)</span><button onClick={() => copyText('curl', curlSnippet)} className="px-2 bg-slate-800 rounded text-cyan-300">{copied === 'curl' ? 'Copied' : 'Copy'}</button></div>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{curlSnippet}</pre>
          </div>
          <div className="border border-slate-800 bg-slate-900 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-xs"><span className="text-slate-400 uppercase">2. Remote MCP Config</span><button onClick={() => copyText('mcp', mcpSnippet)} className="px-2 bg-slate-800 rounded text-emerald-300">{copied === 'mcp' ? 'Copied' : 'Copy'}</button></div>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">{mcpSnippet}</pre>
          </div>
        </section>

        <section className="border border-slate-800 bg-slate-900 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex justify-between text-xs"><span className="font-bold uppercase text-white">x402 v2 Endpoints</span><span className="text-emerald-400">Asset: wrapped SOL</span></div>
          <div className="divide-y divide-slate-800">
            {ENDPOINTS.map((ep) => (
              <div key={ep.path} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs"><span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-bold">{ep.method}</span><code className="text-white font-bold">{ep.path}</code><span className="text-slate-500">• {ep.tier}</span></div>
                  <p className="text-xs text-slate-400 mt-1">{ep.desc}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-300 text-xs font-bold">{ep.price}</span>
                  <button onClick={() => copyText(ep.path, `${BASE_URL}${ep.path}`)} className="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-200">{copied === ep.path ? 'Copied' : 'Copy URL'}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
