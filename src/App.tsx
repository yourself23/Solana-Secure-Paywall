import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

const TREASURY = '2Z6xwB633pMFj3iMj1pUz2ikGrVGGTun7AY3qZDNZip2';
const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

const ENDPOINTS = [
  { tier: 'RPC & PRICE (90,000 lamports)', price: '0.00009 SOL', method: 'POST', path: '/api/rpc/solana', desc: 'Safelisted Solana Mainnet JSON-RPC proxy (94% cheaper than $0.15/call)' },
  { tier: 'RPC & PRICE (90,000 lamports)', price: '0.00009 SOL', method: 'GET', path: '/api/rpc/blockhash', desc: 'Sub-second cached latest Solana Mainnet blockhash' },
  { tier: 'RPC & PRICE (90,000 lamports)', price: '0.00009 SOL', method: 'GET', path: '/api/rpc/quote', desc: 'Live DEX swap liquidity & optimal route quote' },
  { tier: 'RPC & PRICE (90,000 lamports)', price: '0.00009 SOL', method: 'GET', path: '/api/rpc/price', desc: 'Real-time SPL token USD price & pair feed' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/whales', desc: 'Top circulating whale wallets & balance audit' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/rug-check', desc: 'SPL mint authority, freeze authority & holder concentration' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/fees', desc: 'Live priority fee oracle (standard / turbo / urgent microLamports)' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/pools', desc: 'Newly launched Solana DEX token pool profiles' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/alpha', desc: 'Live Solana epoch TPS & top SOL/USDC liquidity pairs' },
  { tier: 'MARKET INTEL (100,000 lamports)', price: '0.0001 SOL', method: 'GET', path: '/api/solana/boosts', desc: 'Boosted Solana token radar from DexScreener' },
  { tier: 'GPU CLOUD (130,000 lamports)', price: '0.00013 SOL', method: 'GET', path: '/api/solana/gpu-rates', desc: 'Live cloud GPU rental hourly rates & availability (H100, A100, 4090)' },
  { tier: 'EXECUTION (1,000,000 lamports)', price: '0.001 SOL', method: 'POST', path: '/api/v1/invoke', desc: '24 live MEV, Jito bundle, sniper & arbitrage engines' },
];

export default function App() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [copied, setCopied] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const copyText = (label: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  };

  const mintPrepaidPass = async () => {
    if (!publicKey) return setStatus('Connect a Solana wallet first.');
    try {
      setLoading(true);
      setStatus('Requesting 0.001 SOL signature...');
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(TREASURY), lamports: 1_000_000 }));
      const sig = await sendTransaction(tx, connection);
      setStatus(`Confirming ${sig.slice(0, 10)}...`);
      await connection.confirmTransaction(sig, 'confirmed');
      const r = await fetch('/api/paywall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
      const data = await r.json();
      if (data.apiKey) { setApiKey(data.apiKey); setStatus('10-Call Agent Pass Issued (0.001 SOL).'); }
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
            <div className="text-xs text-emerald-400 uppercase tracking-widest">x402 v2 Protocol • Solana Mainnet • Native SOL Only</div>
            <h1 className="text-xl md:text-2xl font-bold text-white mt-1">Solana Agent Execution & RPC Gateway</h1>
            <p className="text-xs text-slate-400 mt-1">Zero API keys • Automated HTTP 402 lamport settlement • OpenAPI 3.1 & Remote MCP</p>
          </div>
          <WalletMultiButton />
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-slate-800 bg-slate-900 rounded-xl p-4 space-y-2">
            <div className="text-xs text-slate-400 uppercase">Native SOL Treasury (payTo)</div>
            <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-emerald-300 break-all">
              <span>{TREASURY}</span>
              <button onClick={() => copyText('treasury', TREASURY)} className="shrink-0 px-2 py-1 bg-slate-800 rounded text-white">{copied === 'treasury' ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1 text-xs">
              <a href="/openapi.json" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-cyan-300">/openapi.json</a>
              <a href="/.well-known/x402.json" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-cyan-300">/.well-known/x402.json</a>
              <a href="/.well-known/agent.json" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-cyan-300">/.well-known/agent.json</a>
              <a href="/api/mcp" target="_blank" className="px-2.5 py-1 rounded bg-slate-800 text-emerald-300">/api/mcp (24 Tools)</a>
            </div>
          </div>

          <div className="border border-slate-800 bg-slate-900 rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div>
              <div className="text-xs text-slate-400 uppercase">Prepaid Bot Pass (10 Calls)</div>
              <p className="text-xs text-slate-300 mt-1">Send <span className="text-emerald-400 font-bold">0.001 SOL</span> (1,000,000 lamports) to mint an instant <code className="text-cyan-300">x-api-key</code> header.</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={mintPrepaidPass} disabled={loading} className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs disabled:opacity-50">{loading ? 'Confirming...' : 'Mint 10-Call Pass (0.001 SOL)'}</button>
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
          <div className="px-4 py-3 border-b border-slate-800 flex justify-between text-xs"><span className="font-bold uppercase text-white">Live x402 v2 Native SOL Endpoints (12 Direct + /api/paywall)</span><span className="text-emerald-400">Asset: So11111...11112</span></div>
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
