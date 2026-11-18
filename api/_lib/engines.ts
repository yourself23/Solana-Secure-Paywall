import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createHash, randomInt } from 'node:crypto';

export const AVAILABLE_ENGINES = [
  'whale-wallet-tracker',
  'rug-pull-mint-auditor',
  'holder-concentration-analyzer',
  'priority-fee-oracle',
  'token-boost-radar',
  'liquidity-pool-sniffer',
  'dex-volume-surge-detector',
  'sol-usdc-spread-scanner',
  'solana-tps-health-monitor',
  'validator-stake-tracker',
  'spl-token-metadata-resolver',
  'orca-whirlpool-scanner',
  'meteora-dlmm-yield-finder',
  'pump-fun-bonding-curve',
  'jito-bundle-dispatcher',
  'multi-wallet-jito-injector',
  'cross-dex-router',
  'raydium-swap-automator',
  'limit-order-sniper',
] as const;

export function getAvailableEngines(): readonly string[] {
  return process.env.JUPITER_API_KEY?.trim()
    ? AVAILABLE_ENGINES
    : AVAILABLE_ENGINES.filter((name) => !['cross-dex-router', 'raydium-swap-automator', 'limit-order-sniper'].includes(name));
}

export async function runLiveSolanaEngine(lib: string, rpcUrl: string, params: Record<string, any>) {
  const rpc = async (method: string, p: any[] = []) => {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: p }),
    });
    if (!r.ok) throw new Error(`Solana RPC HTTP ${r.status}`);
    const body = await r.json();
    if (body.error) throw new Error(`Solana RPC: ${body.error.message || 'request failed'}`);
    return body.result;
  };

  const dexFetch = async (path: string) => {
    const r = await fetch(`https://api.dexscreener.com/${path}`);
    if (!r.ok) throw new Error(`DexScreener HTTP ${r.status}`);
    return r.json();
  };

  if (lib === 'jito-bundle-dispatcher' || lib === 'multi-wallet-jito-injector') {
    const transactions = params.transactions;
    if (!Array.isArray(transactions) || transactions.length < 1 || transactions.length > 5 || transactions.some((tx) => typeof tx !== 'string')) {
      throw new Error('Provide 1 to 5 unsigned base64 transactions');
    }
    let tipPayer: PublicKey;
    try { tipPayer = new PublicKey(params.tipPayer); } catch { throw new Error('A valid tipPayer is required'); }
    const tipLamports = Number(params.tipLamports);
    if (!Number.isSafeInteger(tipLamports) || tipLamports < 1000) throw new Error('tipLamports must be at least 1000');
    const decoded = transactions.map((encoded: string) => {
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.toString('base64') !== encoded) throw new Error('Invalid base64 transaction');
      const transaction = VersionedTransaction.deserialize(bytes);
      if (transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) throw new Error('All transactions must be unsigned');
      if (transaction.message.addressTableLookups.length) throw new Error('Transactions using address lookup tables are not supported for bundle planning');
      return transaction;
    });
    const last = decoded[decoded.length - 1];
    if (!last.message.staticAccountKeys[0]?.equals(tipPayer)) throw new Error('tipPayer must be the fee payer of the last transaction');
    const endpoint = process.env.JITO_BLOCK_ENGINE_URL?.trim() || 'https://mainnet.block-engine.jito.wtf';
    const response = await fetch(`${endpoint.replace(/\/+$/, '')}/api/v1/getTipAccounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
    });
    if (!response.ok) throw new Error(`Jito tip accounts HTTP ${response.status}`);
    const result = await response.json();
    if (result.error || !Array.isArray(result.result) || result.result.length === 0) throw new Error('Jito did not return tip accounts');
    const tipAccount = new PublicKey(result.result[randomInt(result.result.length)]);
    const message = TransactionMessage.decompile(last.message);
    message.instructions.push(SystemProgram.transfer({ fromPubkey: tipPayer, toPubkey: tipAccount, lamports: tipLamports }));
    const tippedMessage = last.message.version === 'legacy' ? message.compileToLegacyMessage() : message.compileToV0Message();
    decoded[decoded.length - 1] = new VersionedTransaction(tippedMessage);
    const planned = decoded.map((tx) => {
      const bytes = tx.serialize();
      if (bytes.length > 1232) throw new Error('A planned transaction exceeds Solana transaction size limits');
      return Buffer.from(bytes).toString('base64');
    });
    return {
      engine: lib, network: 'solana-mainnet', status: 'unsigned', transactions: planned,
      tipAccount: tipAccount.toBase58(), tipLamports,
      note: 'Review and sign every transaction, then submit the ordered bundle to Jito; this endpoint does not submit it.',
    };
  }

  if (lib === 'orca-whirlpool-scanner' || lib === 'meteora-dlmm-yield-finder') {
    const url = lib === 'orca-whirlpool-scanner'
      ? 'https://api.orca.so/v2/solana/pools?size=20&sortBy=tvl&sortDirection=desc'
      : 'https://dlmm.datapi.meteora.ag/pools?page=1&page_size=20';
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`${lib} upstream HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.data)) throw new Error(`${lib} upstream returned invalid data`);
    return { engine: lib, network: 'solana-mainnet', source: lib === 'orca-whirlpool-scanner' ? 'orca' : 'meteora', data };
  }

  if (lib === 'pump-fun-bonding-curve') {
    let mint: PublicKey;
    try { mint = new PublicKey(params.mint); } catch { throw new Error('A valid mint is required'); }
    const program = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    const address = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], program)[0];
    const account = await rpc('getAccountInfo', [address.toBase58(), { encoding: 'base64' }]);
    if (!account?.value || account.value.owner !== program.toBase58() || !Array.isArray(account.value.data)) throw new Error('Pump bonding curve not found');
    const data = Buffer.from(account.value.data[0], 'base64');
    const discriminator = createHash('sha256').update('account:BondingCurve').digest().subarray(0, 8);
    if (data.length < 49 || !data.subarray(0, 8).equals(discriminator) || data[48] > 1) throw new Error('Invalid Pump bonding curve account');
    return {
      engine: lib, network: 'solana-mainnet', mint: mint.toBase58(), bondingCurve: address.toBase58(),
      virtualTokenReserves: data.readBigUInt64LE(8).toString(),
      virtualQuoteReserves: data.readBigUInt64LE(16).toString(),
      realTokenReserves: data.readBigUInt64LE(24).toString(),
      realQuoteReserves: data.readBigUInt64LE(32).toString(),
      tokenTotalSupply: data.readBigUInt64LE(40).toString(), complete: data[48] === 1,
    };
  }

  if (lib === 'solana-tps-health-monitor') {
    const [health, epoch, samples] = await Promise.all([rpc('getHealth'), rpc('getEpochInfo'), rpc('getRecentPerformanceSamples', [3])]);
    if (!Array.isArray(samples)) throw new Error('Solana RPC returned invalid performance samples');
    return {
      engine: lib, network: 'solana-mainnet', health, epoch: epoch?.epoch,
      samples: samples.map((sample: any) => ({
        slot: sample.slot,
        transactions: sample.numTransactions,
        seconds: sample.samplePeriodSecs,
        tps: sample.samplePeriodSecs > 0 ? sample.numTransactions / sample.samplePeriodSecs : null,
      })),
    };
  }

  if (lib === 'validator-stake-tracker') {
    const validators = await rpc('getVoteAccounts');
    if (!Array.isArray(validators?.current) || !Array.isArray(validators?.delinquent)) throw new Error('Solana RPC returned invalid vote accounts');
    const mapValidator = (validator: any) => ({
      votePubkey: validator.votePubkey, nodePubkey: validator.nodePubkey,
      activatedStakeLamports: validator.activatedStake, commission: validator.commission,
      lastVote: validator.lastVote, delinquent: validators.delinquent.includes(validator),
    });
    const all = [...validators.current, ...validators.delinquent];
    const selected = params.votePubkey ? all.filter((validator: any) => validator.votePubkey === params.votePubkey) : all.sort((a: any, b: any) => b.activatedStake - a.activatedStake).slice(0, 20);
    return { engine: lib, network: 'solana-mainnet', validators: selected.map(mapValidator) };
  }

  if (lib === 'spl-token-metadata-resolver') {
    let mint: string;
    try { mint = new PublicKey(params.mint).toBase58(); } catch { throw new Error('A valid mint is required'); }
    const program = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const metadataAddress = PublicKey.findProgramAddressSync([Buffer.from('metadata'), program.toBuffer(), new PublicKey(mint).toBuffer()], program)[0];
    const account = await rpc('getAccountInfo', [metadataAddress.toBase58(), { encoding: 'base64' }]);
    if (!account?.value || account.value.owner !== program.toBase58() || !Array.isArray(account.value.data)) throw new Error('Metaplex metadata account not found');
    const data = Buffer.from(account.value.data[0], 'base64');
    if (data.length < 65 || data[0] !== 4 || !data.subarray(33, 65).equals(new PublicKey(mint).toBuffer())) throw new Error('Invalid Metaplex metadata account');
    let offset = 65;
    const readString = () => {
      if (offset + 4 > data.length) throw new Error('Invalid Metaplex metadata string');
      const length = data.readUInt32LE(offset);
      offset += 4;
      if (length > data.length - offset) throw new Error('Invalid Metaplex metadata string');
      const value = data.subarray(offset, offset + length).toString('utf8').replace(/\0+$/, '');
      offset += length;
      return value;
    };
    const name = readString();
    const symbol = readString();
    const uri = readString();
    return { engine: lib, network: 'solana-mainnet', mint, metadataAddress: metadataAddress.toBase58(), name, symbol, uri };
  }

  if (lib === 'liquidity-pool-sniffer' || lib === 'dex-volume-surge-detector' || lib === 'sol-usdc-spread-scanner') {
    const solMint = 'So11111111111111111111111111111111111111112';
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    let mint: string;
    try { mint = lib === 'sol-usdc-spread-scanner' ? solMint : new PublicKey(params.mint).toBase58(); } catch { throw new Error('A valid mint is required'); }
    const result = await dexFetch(`latest/dex/tokens/${mint}`);
    if (!Array.isArray(result?.pairs)) throw new Error('DexScreener returned no pair data');
    const pairs = result.pairs.filter((pair: any) => pair.chainId === 'solana');
    if (lib === 'liquidity-pool-sniffer') {
      return { engine: lib, network: 'solana-mainnet', mint, pools: pairs.slice(0, 20).map((pair: any) => ({
        dex: pair.dexId, pairAddress: pair.pairAddress, baseToken: pair.baseToken,
        quoteToken: pair.quoteToken, liquidityUsd: pair.liquidity?.usd ?? null,
        priceUsd: pair.priceUsd ?? null, createdAt: pair.pairCreatedAt ?? null,
      })) };
    }
    if (lib === 'dex-volume-surge-detector') {
      const surges = pairs.map((pair: any) => {
        const hour = Number(pair.volume?.h1);
        const day = Number(pair.volume?.h24);
        const baseline = (day - hour) / 23;
        return { dex: pair.dexId, pairAddress: pair.pairAddress, volume1hUsd: hour, previousAverageHourUsd: baseline, surgeRatio: baseline > 0 ? hour / baseline : null };
      }).filter((pair: any) => Number.isFinite(pair.volume1hUsd) && Number.isFinite(pair.previousAverageHourUsd) && pair.previousAverageHourUsd >= 0);
      surges.sort((a: any, b: any) => (b.surgeRatio ?? -1) - (a.surgeRatio ?? -1));
      return { engine: lib, network: 'solana-mainnet', mint, pairs: surges.slice(0, 20) };
    }
    const quotes = pairs.flatMap((pair: any) => {
      const nativePrice = Number(pair.priceNative);
      if (!Number.isFinite(nativePrice) || nativePrice <= 0) return [];
      const direct = pair.baseToken?.address === solMint && pair.quoteToken?.address === usdcMint;
      const reverse = pair.baseToken?.address === usdcMint && pair.quoteToken?.address === solMint;
      if (!direct && !reverse) return [];
      return [{ dex: pair.dexId, pairAddress: pair.pairAddress, usdcPerSol: direct ? nativePrice : 1 / nativePrice, liquidityUsd: pair.liquidity?.usd ?? null }];
    }).sort((a: any, b: any) => a.usdcPerSol - b.usdcPerSol);
    const low = quotes[0]?.usdcPerSol;
    const high = quotes.at(-1)?.usdcPerSol;
    return { engine: lib, network: 'solana-mainnet', prices: quotes, spotSpreadUsdc: low !== undefined && high !== undefined ? high - low : null, note: 'Spot pool prices; excludes fees, slippage and execution costs.' };
  }

  if (lib === 'cross-dex-router' || lib === 'raydium-swap-automator' || lib === 'limit-order-sniper') {
    const apiKey = process.env.JUPITER_API_KEY?.trim();
    if (!apiKey) throw new Error('JUPITER_API_KEY is required for swap plans');
    let inputMint: string;
    let outputMint: string;
    let userPublicKey: string;
    try {
      inputMint = new PublicKey(params.inputMint).toBase58();
      outputMint = new PublicKey(params.outputMint).toBase58();
      userPublicKey = new PublicKey(params.userPublicKey).toBase58();
    } catch {
      throw new Error('Valid inputMint, outputMint and userPublicKey are required');
    }
    const amount = String(params.amount || '');
    const slippageBps = Number(params.slippageBps ?? 50);
    if (!/^[1-9]\d*$/.test(amount) || !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 10000 || inputMint === outputMint) {
      throw new Error('A positive atomic amount, distinct mints and slippageBps between 1 and 10000 are required');
    }
    if (lib === 'limit-order-sniper') {
      const takingAmount = String(params.takingAmount || '');
      if (!/^[1-9]\d*$/.test(takingAmount)) throw new Error('A positive takingAmount in atomic units is required');
      const response = await fetch('https://api.jup.ag/trigger/v1/createOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ inputMint, outputMint, maker: userPublicKey, payer: userPublicKey, params: { makingAmount: amount, takingAmount }, computeUnitPrice: 'auto' }),
      });
      if (!response.ok) throw new Error(`Jupiter trigger HTTP ${response.status}`);
      const order = await response.json();
      if (typeof order.transaction !== 'string') throw new Error('Jupiter did not return an order transaction');
      const transaction = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
      if (!transaction.message.staticAccountKeys[0]?.equals(new PublicKey(userPublicKey)) || transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
        throw new Error('Jupiter returned a signed transaction or unexpected fee payer');
      }
      return { engine: lib, network: 'solana-mainnet', status: 'unsigned', orderTransaction: order.transaction, requestId: order.requestId };
    }
    const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippageBps) });
    if (lib === 'raydium-swap-automator') query.set('dexes', 'Raydium');
    const quoteResponse = await fetch(`https://api.jup.ag/swap/v1/quote?${query}`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) });
    if (!quoteResponse.ok) throw new Error(`Jupiter quote HTTP ${quoteResponse.status}`);
    const quote = await quoteResponse.json();
    if (params.minOutputAmount !== undefined) {
      const minimum = String(params.minOutputAmount);
      if (!/^[1-9]\d*$/.test(minimum) || quote.inputMint !== inputMint || quote.outputMint !== outputMint ||
          quote.inAmount !== amount || quote.swapMode !== 'ExactIn' || quote.slippageBps !== slippageBps ||
          !/^[1-9]\d*$/.test(String(quote.otherAmountThreshold || '')) ||
          !/^[1-9]\d*$/.test(String(quote.outAmount || '')) ||
          BigInt(quote.otherAmountThreshold) > BigInt(quote.outAmount)) {
        throw new Error('Invalid minimum output or Jupiter exact-in quote');
      }
      if (BigInt(quote.otherAmountThreshold) < BigInt(minimum)) {
        return { engine: lib, network: 'solana-mainnet', status: 'threshold_not_met', quote };
      }
    }
    const swapResponse = await fetch('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ userPublicKey, quoteResponse: quote }),
      signal: AbortSignal.timeout(15000),
    });
    if (!swapResponse.ok) throw new Error(`Jupiter swap HTTP ${swapResponse.status}`);
    const swap = await swapResponse.json();
    if (typeof swap.swapTransaction !== 'string') throw new Error('Jupiter did not return a swap transaction');
    const transaction = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
    if (!transaction.message.staticAccountKeys[0]?.equals(new PublicKey(userPublicKey)) || transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
      throw new Error('Jupiter returned a signed transaction or unexpected fee payer');
    }
    return { engine: lib, network: 'solana-mainnet', status: 'unsigned', quote, swapTransaction: swap.swapTransaction, lastValidBlockHeight: swap.lastValidBlockHeight };
  }

  if (lib === 'whale-wallet-tracker') {
    const w = typeof params?.targetWallet === 'string' && params.targetWallet.length >= 32 ? params.targetWallet.trim() : null;
    if (w) {
      const [bal, sigs] = await Promise.all([rpc('getBalance', [w, { commitment: 'confirmed' }]), rpc('getSignaturesForAddress', [w, { limit: 8 }])]);
      return { engine: lib, network: 'solana-mainnet', targetWallet: w, solBalance: Number(((bal?.value ?? 0) / 1e9).toFixed(4)), recentTransactions: (sigs || []).map((s: any) => ({ signature: s.signature, slot: s.slot, status: s.err ? 'failed' : 'confirmed' })) };
    }
    const [slot, largest] = await Promise.all([rpc('getSlot'), rpc('getLargestAccounts', [{ filter: 'circulating' }])]);
    return { engine: lib, network: 'solana-mainnet', currentSlot: slot, topWhales: (largest?.value || []).slice(0, 10).map((a: any, i: number) => ({ rank: i + 1, address: a.address, solBalance: Number(((a.lamports ?? 0) / 1e9).toFixed(2)) })) };
  }

  if (lib === 'token-boost-radar') {
    const endpoint = 'token-boosts/latest/v1';
    const profiles = await dexFetch(endpoint);
    if (!Array.isArray(profiles)) throw new Error('DexScreener returned an invalid token list');
    const tokens = profiles.filter((p: any) => p.chainId === 'solana').slice(0, 12).map((p: any) => ({ tokenAddress: p.tokenAddress, description: p.description || null, url: p.url, totalAmount: p.totalAmount ?? null }));
    return { engine: lib, network: 'solana-mainnet', tokens };
  }

  if (lib === 'rug-pull-mint-auditor' || lib === 'holder-concentration-analyzer') {
    let mint: string;
    try { mint = new PublicKey(params.mint).toBase58(); } catch { throw new Error('A valid mint is required'); }
    const [info, supply, holders] = await Promise.all([rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]), rpc('getTokenSupply', [mint]), rpc('getTokenLargestAccounts', [mint])]);
    if (info?.value?.data?.parsed?.type !== 'mint') throw new Error('The account is not a parsed token mint');
    const parsed = info.value.data.parsed.info;
    return { engine: lib, network: 'solana-mainnet', mint, mintAuthorityActive: Boolean(parsed.mintAuthority), freezeAuthorityActive: Boolean(parsed.freezeAuthority), supply: supply?.value?.uiAmountString ?? '0', topHolders: (holders?.value || []).slice(0, 5).map((h: any) => ({ address: h.address, uiAmount: h.uiAmount })) };
  }

  if (lib === 'priority-fee-oracle') {
    const [fees, slot, blockhash] = await Promise.all([rpc('getRecentPrioritizationFees', []), rpc('getSlot'), rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])]);
    const sorted = (Array.isArray(fees) ? fees : []).map((f: any) => Number(f.prioritizationFee || 0)).sort((a: number, b: number) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    return { engine: lib, network: 'solana-mainnet', currentSlot: slot, latestBlockhash: blockhash?.value?.blockhash ?? null, recommendedMicroLamports: { standard: p50, turbo: p90, urgent: Math.max(p90 * 2, 10000) } };
  }

  throw new Error(`Engine ${lib} is not implemented`);
}
