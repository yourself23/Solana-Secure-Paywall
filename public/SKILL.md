# Solana Secure Paywall

Solana Mainnet analytics and unsigned Jupiter swap plans. Prepaid passes use native SOL; x402 v2 uses wrapped SOL through a facilitator. Swap transactions require user review and signing.

Discover live configuration and available engines at `/api/sales`. Request `/api/v1/invoke?libraryId=whale-wallet-tracker` for an x402 v2 payment challenge. For a prepaid pass, transfer the configured native SOL amount from your wallet to the configured treasury, sign `paywall:<transaction signature>` with that wallet, and POST `/api/paywall` with `signature`, `wallet`, and base64 `walletProof`. Use the returned `apiKey` in the `x-api-key` header for `/api/v1/invoke`.

For `cross-dex-router` or `raydium-swap-automator`, supply `inputMint`, `outputMint`, `userPublicKey`, `amount` in atomic units, and optionally `slippageBps`. The response is an unsigned Jupiter swap transaction, not an executed trade.

`limit-order-sniper` additionally requires `takingAmount`. Jito bundle plans require one to five unsigned base64 `transactions`, `tipPayer` matching the final fee payer, and `tipLamports` of at least 1000. Address lookup tables are unsupported. Plans must be reviewed, signed and submitted by the user.
