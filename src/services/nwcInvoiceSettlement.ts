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
  // Stateless wallets (notably LNbits) can expose the incoming preimage and
  // a settlement timestamp for failed/expired invoices. Lookup alone is unknown.
  if (result.state === undefined) return null;
  const paid = result.state === 'settled' && hasInvoiceSettlementProof(proof, paymentHash);
  // Contradictory settlement claims are unknown, so they cannot authorize
  // replacing the invoice either.
  if (!paid && (result.state === 'settled' || result.settled_at)) return null;
  return paid ? { paid, invoice, ...proof } : { paid: false, invoice };
}

/** Confirm a stateless lookup against the wallet's successful incoming history.
 * Absence from a bounded page cannot prove unpaid; keep replacement fail-closed. */
export function confirmListedInvoiceSettlement(
  lookup: unknown,
  transactions: unknown,
  paymentHash: string,
): InvoiceSettlement | null {
  if (!lookup || typeof lookup !== 'object' || !Array.isArray(transactions)) return null;
  const raw = lookup as Record<string, unknown>;
  if (raw.state !== undefined || raw.type !== 'incoming' || raw.error != null) return null;
  for (const value of transactions) {
    if (!value || typeof value !== 'object') continue;
    const tx = value as Record<string, unknown>;
    if (tx.type !== 'incoming' || (tx.state !== undefined && tx.state !== 'settled')) continue;
    const listed = parseInvoiceSettlement(
      { ...tx, preimage: tx.preimage ?? raw.preimage, state: 'settled' },
      paymentHash,
    );
    if (!listed?.paid) continue;
    // Validate lookup hash/invoice/proof as well, using the confirmed timestamp.
    return parseInvoiceSettlement(
      { ...raw, state: 'settled', settled_at: listed.settledAt },
      paymentHash,
    );
  }
  return null;
}
