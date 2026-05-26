import { decode as bolt11Decode } from 'light-bolt11-decoder';

// Pull the `payment_hash` field off a bolt11 invoice. Used wherever
// we need to correlate a generated invoice with a settlement event
// (ReceiveSheet, NfcReadSheet, …) — `WalletContext.expectPayment`
// + `WalletContext.lastIncomingPayment` both key on this hash. The
// helper was inlined in three places before this; one source of
// truth keeps decode behaviour consistent and lets the dev-warning
// strategy live in one spot.
export function paymentHashFromBolt11(bolt11: string): string | null {
  try {
    const decoded = bolt11Decode(bolt11);
    const section = decoded.sections?.find((s: { name: string }) => s.name === 'payment_hash') as
      | { value?: string }
      | undefined;
    return section?.value ?? null;
  } catch (error) {
    if (__DEV__) console.warn('[bolt11] payment-hash decode failed:', error);
    return null;
  }
}
