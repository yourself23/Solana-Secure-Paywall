# Solana Secure Paywall

Solana Mainnet analytics and unsigned Jupiter swap plans with paid API access. Prepaid passes use **native SOL**; x402 v2 payments use **wrapped SOL (wSOL)** through the configured facilitator. No service signs or submits a user's swap transaction.

## Configuration

Copy `.env.example` to `.env` and configure `TREASURY_ADDRESS`, Upstash Redis, a long random `PAYWALL_SECRET`, and `APP_URL`. Keep `PAYWALL_SECRET` stable so a payment can be redeemed again after an interrupted response. Configure `SOLANA_RPC_URL` and `VITE_SOLANA_RPC_URL` for Solana Mainnet; the public RPC is the default. Set `JUPITER_API_KEY` for swap plans and `X402_FACILITATOR_URL` for a facilitator supporting Solana x402 v2 exact payments and wSOL. The treasury needs a wSOL associated token account for x402 payments. The live treasury and pass price are available from `GET /api/sales`; `PAYMENT_AMOUNT_SOL` defaults to 0.001 SOL for a 10-call pass or one invoke request.

Run `npm start` for the local server with real API handlers, or deploy the Vercel functions. `npm run dev` serves only the Vite frontend.

The GitHub Actions production workflow runs on pushes to `main`, checks the code and deploys to the linked Vercel project. Vercel uses `npm ci` and `package-lock.json` to install the CommonJS-compatible UUID override required by Solana's RPC dependency. The workflow requires the `VERCEL_TOKEN` repository secret and production environment variables configured in Vercel; a successful build alone does not confirm that Redis, the facilitator or Jupiter are configured. The external sniper container is not deployed by this workflow.

## Payments

For prepaid access, transfer the configured amount of native SOL directly from a wallet to the configured treasury. Sign the UTF-8 message `paywall:<transaction signature>` with that same wallet. POST `/api/paywall` with `{"signature":"<transaction signature>","wallet":"<wallet public key>","walletProof":"<base64 Ed25519 signature>"}`. The response includes an `apiKey`; pass it as `x-api-key` to `POST /api/v1/invoke?libraryId=whale-wallet-tracker`. A repeated redemption with the same wallet proof returns the same key without issuing additional credits.

For x402 access, request a supported endpoint without payment and use the `PAYMENT-REQUIRED` header to construct an x402 v2 exact payment in wSOL. Send the resulting partially signed payment payload as `PAYMENT-SIGNATURE`. The facilitator verifies and settles the transfer; the response carries `PAYMENT-RESPONSE`. The facilitator and treasury must support wSOL before accepting payments.

`GET /api/sales` lists available engines. `cross-dex-router` and `raydium-swap-automator` require `inputMint`, `outputMint`, `userPublicKey`, an input `amount` in atomic units, and optional `slippageBps`. `limit-order-sniper` additionally requires `takingAmount`. These return unsigned Jupiter transactions for review and signing.

`jito-bundle-dispatcher` and `multi-wallet-jito-injector` accept `transactions` (one to five unsigned base64 transactions), `tipPayer` (the final transaction's fee payer), and `tipLamports` (at least 1000). They return an unsigned ordered bundle with a tip added to the final transaction. Transactions using address lookup tables are not supported; signing and submission are the user's responsibility.

The paid sniper-daemon engine, MEV arbitrage, flash-loan arbitrage, mempool scanner and smart-money copy scanner remain unimplemented and return 501 before payment. Flash-loan execution requires an explicitly configured protocol.

The mint auditor, holder analyzer, liquidity pool sniffer, and volume surge detector require a `mint` parameter; the `/api/solana/rug-check` and `/api/solana/pools` routes also require it.

Discovery: `/openapi.json`, `/.well-known/x402.json`, `/SKILL.md`, `/llms.txt`, and MCP at `/api/mcp`.

## Operator sniper worker

Vercel Functions cannot host an always-on daemon. Run `Dockerfile.sniper` on an external always-on Docker host; Vercel serves only the status API. Build with `docker build -f Dockerfile.sniper -t solana-sniper .`. Set the Upstash credentials and `JUPITER_API_KEY` from `.env.example`, plus `SNIPER_JOB_ID`, `SNIPER_INPUT_MINT`, `SNIPER_OUTPUT_MINT`, `SNIPER_USER_PUBLIC_KEY`, `SNIPER_INPUT_AMOUNT` and `SNIPER_MIN_OUTPUT_AMOUNT`. Amounts are positive atomic units; configure optional slippage and polling interval (5 seconds to 1 hour). Pass secrets through the host's secret manager, not in the image. `npm run worker:sniper` runs the same worker locally.

The worker checks Jupiter exact-input quotes until the quote's slippage-adjusted `otherAmountThreshold` reaches the configured minimum. It stores one unsigned plan in Redis and stops requesting quotes for that job. It never signs or submits trades. Set the same Upstash credentials and a separate long random `SNIPER_STATUS_SECRET` on Vercel, then retrieve the status with `GET /api/sniper-status?id=<job-id>` and `Authorization: Bearer <secret>`. Treat that secret as operator access to all sniper job results.

Plans use recent blockhashes and can expire before review; check `lastValidBlockHeight` against Solana before signing. To re-arm after a plan or change a job's trading parameters, use a new `SNIPER_JOB_ID` and restart the worker. Redis state is persistent, and a per-job lock prevents concurrent workers from overwriting one another. Status includes `updatedAt`; a stale monitoring timestamp means the worker or its dependencies may be offline. This operator-only automation is separate from the paid API.
