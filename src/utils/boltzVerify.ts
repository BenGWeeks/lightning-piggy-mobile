// Client-side verification of Boltz API responses (#948-era swap hardening).
// A reverse swap is only trustless if the invoice Boltz hands back is a HODL
// invoice tied to OUR preimage for OUR amount: pay anything else and the sats
// are gone with nothing claimable and no HODL-timeout refund. These checks
// run BEFORE the invoice is paid, so a mismatch is a clean pre-commit failure
// (no money has moved). Pure module — no I/O (coverage scope: src/utils).
import { paymentHashFromBolt11, amountSatsFromBolt11 } from './bolt11';

export interface ReverseSwapVerificationInput {
  /** The invoice Boltz returned. */
  invoice: string;
  /** Hex sha256 of the preimage WE generated for this swap. */
  expectedPaymentHash: string;
  /** The invoice amount we requested (sats). */
  expectedAmountSats: number;
}

/**
 * Throws with a precise reason when the invoice doesn't bind to our preimage
 * hash or charges a different amount. Returns silently when it checks out.
 */
export function verifyReverseSwapInvoice(input: ReverseSwapVerificationInput): void {
  const { invoice, expectedPaymentHash, expectedAmountSats } = input;
  if (!invoice) {
    throw new Error('Boltz returned no invoice for the reverse swap');
  }

  const paymentHash = paymentHashFromBolt11(invoice);
  if (!paymentHash) {
    throw new Error('Boltz invoice could not be decoded — refusing to pay it');
  }
  if (paymentHash.toLowerCase() !== expectedPaymentHash.toLowerCase()) {
    throw new Error(
      'Boltz invoice payment hash does not match our preimage — refusing to pay (paying it would hand over funds with nothing claimable)',
    );
  }

  const amountSats = amountSatsFromBolt11(invoice);
  if (amountSats === null) {
    throw new Error('Boltz invoice carries no amount — refusing to pay it');
  }
  if (amountSats !== expectedAmountSats) {
    throw new Error(
      `Boltz invoice amount (${amountSats} sats) does not match the requested swap amount (${expectedAmountSats} sats) — refusing to pay`,
    );
  }
}
