export async function runLiveSolanaEngine(lib: string, rpcUrl: string, params: Record<string, any>) {
  const rpc = async (method: string, p: any[] = []) => {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: p }),
    });
    return (await r.json())?.result;
  };

  const dexFetch = async (path: string) => {
    const u = ['https:/', '://dexscreener.com', path].join('/');
    return fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  };

  if (lib === 'whale-wallet-tracker' || lib === 'smart-money-copy-scanner') {
    const w = typeof params?.targetWallet === 'string' && params.targetWallet.length >= 32 ? params.targetWallet.trim() : null;
    if (w) {
      const [bal, sigs] = await Promise.all([rpc('getBalance', [w, { commitment: 'confirmed' }]), rpc('getSignaturesForAddress', [w, { limit: 8 }])]);
      return { engine: lib, network: 'solana-mainnet', targetWallet: w, solBalance: Number(((bal?.value ?? 0) / 1e9).toFixed(4)), recentTransactions: (sigs || []).map((s: any) => ({ signature: s.signature, slot: s.slot, status: s.err ? 'failed' : 'confirmed' })) };
    }
    const [slot, largest] = await Promise.all([rpc('getSlot'), rpc('getLargestAccounts', [{ filter: 'circulating' }])]);
    return { engine: lib, network: 'solana-mainnet', currentSlot: slot, topWhales: (largest?.value || []).slice(0, 10).map((a: any, i: number) => ({ rank: i + 1, address: a.address, solBalance: Number(((a.lamports ?? 0) / 1e9).toFixed(2)) })) };
  }

  if (lib === 'liquidity-pool-sniffer' || lib === 'pump-fun-bonding-curve' || lib === 'token-boost-radar') {
    const endpoint = lib === 'token-boost-radar' ? 'token-boosts/latest/v1' : 'token-profiles/latest/v1';
    const profiles = await dexFetch(endpoint);
    const pools = (Array.isArray(profiles) ? profiles : []).filter((p: any) => p.chainId === 'solana').slice(0, 12).map((p: any) => ({ tokenAddress: p.tokenAddress, description: p.description || 'Active Solana pool', url: p.url, totalAmount: p.totalAmount ?? null }));
    return { engine: lib, network: 'solana-mainnet', detectedPoolsCount: pools.length, freshSolanaPools: pools };
  }

  if (lib === 'rug-pull-mint-auditor' || lib === 'holder-concentration-analyzer') {
    const mint = (typeof params?.mint === 'string' && params.mint.length >= 32 ? params.mint : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').trim();
    const [info, supply, holders] = await Promise.all([rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]), rpc('getTokenSupply', [mint]), rpc('getTokenLargestAccounts', [mint])]);
    const parsed = info?.value?.data?.parsed?.info || {};
    return { engine: lib, network: 'solana-mainnet', mint, mintAuthorityActive: Boolean(parsed.mintAuthority), freezeAuthorityActive: Boolean(parsed.freezeAuthority), supply: supply?.value?.uiAmountString ?? '0', topHolders: (holders?.value || []).slice(0, 5).map((h: any) => ({ address: h.address, uiAmount: h.uiAmount })) };
  }

  if (lib === 'priority-fee-oracle' || lib === 'jito-bundle-dispatcher' || lib === 'multi-wallet-jito-injector') {
    const [fees, slot, blockhash] = await Promise.all([rpc('getRecentPrioritizationFees', []), rpc('getSlot'), rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])]);
    const sorted = (Array.isArray(fees) ? fees : []).map((f: any) => Number(f.prioritizationFee || 0)).sort((a: number, b: number) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    return { engine: lib, network: 'solana-mainnet', currentSlot: slot, latestBlockhash: blockhash?.value?.blockhash ?? null, recommendedMicroLamports: { standard: p50, turbo: p90, urgent: Math.max(p90 * 2, 10000) } };
  }

  if (lib === 'mempool-alpha-scanner' || lib === 'cross-dex-router' || lib === 'mev-arbitrage-bot' || lib === 'flash-loan-arbitrage') {
    const tokenMint = (typeof params?.mint === 'string' && params.mint.length >= 32 ? params.mint : 'So11111111111111111111111111111111111111112').trim();
    const [perf, epoch, dex] = await Promise.all([rpc('getRecentPerformanceSamples', [3]), rpc('getEpochInfo'), dexFetch(`latest/dex/tokens/${tokenMint}`)]);
    const s = Array.isArray(perf) && perf.length > 0 ? perf : null;
    const tps = s && s.samplePeriodSecs > 0 ? Math.round(s.numTransactions / s.samplePeriodSecs) : null;
    const pairs = (dex?.pairs || []).filter((p: any) => p.chainId === 'solana').slice(0, 6).map((p: any) => ({ dex: p.dexId, pair: `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`, priceUsd: p.priceUsd, volume24hUsd: p.volume?.h24 ?? 0, liquidityUsd: p.liquidity?.usd ?? 0, priceChange1h: p.priceChange?.h1 ?? 0 }));
    return { engine: lib, network: 'solana-mainnet', epoch: epoch?.epoch ?? null, liveTps: tps, dexRoutes: pairs };
  }

  const [slot, epoch, supply] = await Promise.all([rpc('getSlot'), rpc('getEpochInfo'), rpc('getSupply')]);
  return { status: 'executed', engine: lib, network: 'solana-mainnet', confirmedSlot: slot, epoch: epoch?.epoch ?? null, circulatingSol: Number(((supply?.value?.circulating ?? 0) / 1e9).toFixed(0)), timestamp: new Date().toISOString() };
}
