# Solana Secure Paywall — Autonomous Bot & AI Agent API Gateway

Direct, non-custodial Solana execution, sniper, Jito bundle, and arbitrage APIs gated by **x402 Solana SPL USDC** credit bundles (**10 USDC = 60 API calls**) with **zero free trials — 100% paid USDC access**.

- **Live Gateway:** https://solana-secure-paywall.vercel.app
- **x402 Discovery Manifest:** https://solana-secure-paywall.vercel.app/.well-known/x402.json
- **Agent Skill Spec:** https://solana-secure-paywall.vercel.app/SKILL.md
- **LLM Index:** https://solana-secure-paywall.vercel.app/llms.txt
- **Network:** `solana-mainnet`
- **Payment Asset:** Solana SPL USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
- **Treasury Recipient:** `2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym`

## Quick Integration

1. **Invoke Engine (`GET` or `POST /api/v1/invoke?libraryId=solana-sniper-daemon`):**
   Pass headers `x-wallet-address`, `x-auth-timestamp` (Unix ms), and `x-auth-signature` (Base58 Ed25519 signature of `invoke:<wallet>:<timestamp>`).
2. **Pay on `HTTP 402` (`POST /api/paywall`):**
   Transfer **10 USDC** (`10000000` base units) on Solana Mainnet to `2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym`, then POST `{"signature":"<TX_SIG>","wallet":"<WALLET>","libraryId":"default"}` to unlock 60 universal calls.

### Available Engines
`solana-sniper-daemon`, `mev-arbitrage-bot`, `jito-bundle-dispatcher`, `liquidity-pool-sniffer`, `raydium-swap-automator`, `pump-fun-bonding-curve`, `whale-wallet-tracker`, `flash-loan-arbitrage`, `multi-wallet-jito-injector`, `limit-order-sniper`, `cross-dex-router`, `mempool-alpha-scanner`
