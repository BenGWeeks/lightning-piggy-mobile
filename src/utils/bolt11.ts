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

/**
 * The invoice amount in whole sats, or null for an amountless invoice / a
 * decode failure. Used by the Boltz reverse-swap verification to confirm the
 * invoice Boltz returned actually charges what we asked to swap
 * (utils/boltzVerify) — a wrong amount must fail closed before paying.
 */
export function amountSatsFromBolt11(bolt11: string): number | null {
  try {
    const decoded = bolt11Decode(bolt11);
    const section = decoded.sections?.find((s: { name: string }) => s.name === 'amount') as
      | { value?: string }
      | undefined;
    if (!section?.value) return null;
    const msats = Number(section.value);
    if (!Number.isFinite(msats) || msats < 0) return null;
    return Math.floor(msats / 1000);
  } catch (error) {
    if (__DEV__) console.warn('[bolt11] amount decode failed:', error);
    return null;
  }
}
