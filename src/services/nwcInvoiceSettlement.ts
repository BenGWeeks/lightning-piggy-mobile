import { paymentHashFromBolt11 } from '../utils/bolt11';
import { matchesPaymentHash } from '../utils/paymentCompletion';

export interface InvoiceSettlement {
  paid: boolean;
  invoice?: string;
  preimage?: string;
  /** Wallet settlement timestamp, in Unix seconds. */
  settledAt?: number;
}

export function hasInvoiceSettlementProof(
  proof: { settledAt?: number; preimage?: string },
  paymentHash: string,
): boolean {
  return (
    typeof proof.settledAt === 'number' &&
    Number.isSafeInteger(proof.settledAt) &&
    proof.settledAt > 0 &&
    matchesPaymentHash(proof.preimage, paymentHash)
  );
}

/** Fail closed on malformed, contradictory or unrelated wallet responses. */
export function parseInvoiceSettlement(
  value: unknown,
  paymentHash: string,
): InvoiceSettlement | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (result.error != null) return null;
  if (
    typeof result.payment_hash !== 'string' ||
    result.payment_hash.toLowerCase() !== paymentHash.toLowerCase()
  )
    return null;
  const invoice = typeof result.invoice === 'string' ? result.invoice : undefined;
  if (
    result.invoice !== undefined &&
    (!invoice || paymentHashFromBolt11(invoice)?.toLowerCase() !== paymentHash.toLowerCase())
  )
    return null;
  const proof = {
    settledAt: typeof result.settled_at === 'number' ? result.settled_at : undefined,
    preimage: typeof result.preimage === 'string' ? result.preimage : undefined,
  };
  const paid =
    (result.state === undefined || result.state === 'settled') &&
    hasInvoiceSettlementProof(proof, paymentHash);
  // Contradictory settlement claims are unknown, so they cannot authorize
  // replacing the invoice either.
  if (!paid && (result.state === 'settled' || result.settled_at)) return null;
  return paid ? { paid, invoice, ...proof } : { paid: false, invoice };
}
