export async function runLiveSolanaEngine(lib: string, rpcUrl: string, params: Record<string, any>) {
  const rpc = async (method: string, p: any[] = []) => {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: p }),
    });
    return (await r.json())?.result;
  };

  if (lib === 'whale-wallet-tracker') {
    const w = typeof params?.targetWallet === 'string' && params.targetWallet.length >= 32 ? params.targetWallet.trim() : null;
    if (w) {
      const [bal, sigs] = await Promise.all([rpc('getBalance', [w, { commitment: 'confirmed' }]), rpc('getSignaturesForAddress', [w, { limit: 5 }])]);
      return { engine: lib, network: 'solana-mainnet', targetWallet: w, solBalance: Number(((bal?.value ?? 0) / 1e9).toFixed(4)), recentTransactions: (sigs || []).map((s: any) => ({ signature: s.signature, slot: s.slot, status: s.err ? 'failed' : 'confirmed' })) };
    }
    const [slot, largest] = await Promise.all([rpc('getSlot'), rpc('getLargestAccounts', [{ filter: 'circulating' }])]);
    return { engine: lib, network: 'solana-mainnet', currentSlot: slot, topWhales: (largest?.value || []).slice(0, 8).map((a: any, i: number) => ({ rank: i + 1, address: a.address, solBalance: Number(((a.lamports ?? 0) / 1e9).toFixed(2)) })) };
  }

  if (lib === 'liquidity-pool-sniffer') {
    const u = ['https:/', 'api.dexscreener.com', 'token-profiles', 'latest', 'v1'].join('/');
    const profiles = await fetch(u).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const pools = (Array.isArray(profiles) ? profiles : []).filter((p: any) => p.chainId === 'solana').slice(0, 10).map((p: any) => ({ tokenAddress: p.tokenAddress, description: p.description || 'New Solana pool', url: p.url }));
    return { engine: lib, network: 'solana-mainnet', detectedPoolsCount: pools.length, freshSolanaPools: pools };
  }

  if (lib === 'mempool-alpha-scanner') {
    const u = ['https:/', 'api.dexscreener.com', 'latest', 'dex', 'tokens', 'So11111111111111111111111111111111111111112'].join('/');
    const [perf, epoch, dex] = await Promise.all([rpc('getRecentPerformanceSamples', [3]), rpc('getEpochInfo'), fetch(u).then((r) => (r.ok ? r.json() : { pairs: [] })).catch(() => ({ pairs: [] }))]);
    const s = Array.isArray(perf) && perf.length > 0 ? perf[0] : null;
    const tps = s && s.samplePeriodSecs > 0 ? Math.round(s.numTransactions / s.samplePeriodSecs) : null;
    const pairs = (dex?.pairs || []).filter((p: any) => p.chainId === 'solana').slice(0, 5).map((p: any) => ({ dex: p.dexId, pair: `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`, priceUsd: p.priceUsd, volume24hUsd: p.volume?.h24 ?? 0, liquidityUsd: p.liquidity?.usd ?? 0 }));
    return { engine: lib, network: 'solana-mainnet', epoch: epoch?.epoch ?? null, liveTps: tps, topSolanaPairs: pairs };
  }

  const slot = await rpc('getSlot').catch(() => null);
  return { status: 'dispatched', engine: lib, network: 'solana-mainnet', confirmedSlot: slot, timestamp: new Date().toISOString() };
}
