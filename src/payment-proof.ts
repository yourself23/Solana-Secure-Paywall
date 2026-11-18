export async function createPaymentProof(signature: string, signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined): Promise<string> {
  if (!signMessage) throw new Error('Your wallet must support message signing to redeem a payment.');
  const signed = await signMessage(new TextEncoder().encode(`paywall:${signature}`));
  return btoa(String.fromCharCode(...signed));
}
