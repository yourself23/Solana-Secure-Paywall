# Solana Secure Paywall

Solana Mainnet analytics and unsigned Jupiter swap plans. Prepaid passes accept native SOL or USDC; direct x402 v2 calls use wrapped SOL through a facilitator. Swap transactions require user review and signing.

Discover live configuration and available engines at `/api/sales`. Request `/api/v1/invoke?libraryId=whale-wallet-tracker` for an x402 v2 payment challenge. For a prepaid pass, transfer the configured native SOL amount or 10 USDC to the configured treasury, sign `paywall:<transaction signature>` with a wallet that signed the transaction, and POST `/api/paywall` with `signature`, `wallet`, and base64 `walletProof`. Use the returned `apiKey` in the `x-api-key` header for `/api/v1/invoke`. Proofless redemption is first-claim only: another party can claim any eligible public transaction first, even if its payer plans to use wallet proof, and a proofless key cannot be recovered by retrying.

For `cross-dex-router` or `raydium-swap-automator`, supply `inputMint`, `outputMint`, `userPublicKey`, `amount` in atomic units, and optionally `slippageBps`. The response is an unsigned Jupiter swap transaction, not an executed trade.

`limit-order-sniper` additionally requires `takingAmount`. Jito bundle plans require one to five unsigned base64 `transactions`, `tipPayer` matching the final fee payer, and `tipLamports` of at least 1000. Address lookup tables are unsupported. Plans must be reviewed, signed and submitted by the user.
