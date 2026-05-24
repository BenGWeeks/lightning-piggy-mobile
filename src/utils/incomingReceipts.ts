import type { WalletTransaction } from '../types/wallet';

export interface NewReceipt {
  paymentHash: string;
  amountSats: number;
}

// Returns the settled, incoming transactions whose payment_hash isn't in
// `seenHashes` — i.e. genuinely new receives to announce.
//
// Detecting receives by *transaction identity* (payment_hash) rather than by
// balance-diffing is what stops a single payment being announced repeatedly:
// a flapping / stale relay makes the balance bounce (e.g. 1011 → 1122 → 1011 →
// 1122), and a balance-diff detector re-fires "+111 received" on every upward
// bounce. Keyed by hash, the same payment is announced exactly once (#653).
//
// Only settled incoming txns count (a pending invoice isn't a receipt yet), and
// only those carrying a payment_hash (the dedup key). Callers seed `seenHashes`
// from the wallet's existing history on first sight so launch doesn't re-announce
// past payments.
export function pickNewReceipts(
  transactions: readonly WalletTransaction[],
  seenHashes: ReadonlySet<string>,
): NewReceipt[] {
  const fresh: NewReceipt[] = [];
  for (const tx of transactions) {
    if (tx.type !== 'incoming') continue;
    if (typeof tx.settled_at !== 'number') continue;
    if (!tx.paymentHash) continue;
    if (seenHashes.has(tx.paymentHash)) continue;
    fresh.push({ paymentHash: tx.paymentHash, amountSats: tx.amount });
  }
  return fresh;
}

// All payment_hashes of settled incoming txns — used to seed the seen-set on
// first sight of a wallet (silent baseline: don't announce existing history).
export function settledIncomingHashes(transactions: readonly WalletTransaction[]): Set<string> {
  const hashes = new Set<string>();
  for (const tx of transactions) {
    if (tx.type === 'incoming' && typeof tx.settled_at === 'number' && tx.paymentHash) {
      hashes.add(tx.paymentHash);
    }
  }
  return hashes;
}
