export async function notifyPaymentReceived(params: {
  amountLamports: number;
  signature: string;
  source: string;
  payer?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return;
  const to = process.env.ALERT_EMAIL?.trim() || 'timothyhuff25@gmail.com';
  const sol = (params.amountLamports / 1_000_000_000).toFixed(6).replace(/\.?0+$/, '');
  const treasury = process.env.TREASURY_ADDRESS?.trim() || 'configured treasury';
  try {
    await fetch('https://resend.com', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `paywall-alert-${params.signature}`,
      },
      body: JSON.stringify({
        from: 'Solana Paywall Alerts <onboarding@resend.dev>',
        to: [to],
        subject: `[Solana-Secure-Paywall] +${sol} SOL Received`,
        text: [
          `New Solana Mainnet payment settled on Solana-Secure-Paywall.`,
          `Amount: ${sol} SOL (${params.amountLamports} lamports)`,
          `Endpoint / Source: ${params.source}`,
          params.payer ? `Payer: ${params.payer}` : null,
          `Treasury: ${treasury}`,
          `Transaction: https://solscan.io{params.signature}`,
        ].filter(Boolean).join('\n'),
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Non-blocking: never fail a paid API response if email delivery times out
  }
}
