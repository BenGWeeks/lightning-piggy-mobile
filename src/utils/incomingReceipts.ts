import type { WalletTransaction } from '../types/wallet';

export interface NewReceipt {
  paymentHash: string;
  amountSats: number;
  /** Unix seconds the payment settled — used to pick the newest deterministically. */
  settledAt: number;
}

// A Lightning payment hash is 32 bytes → 64 hex chars. Some NWC backends return
// null / truncated / otherwise malformed `payment_hash` values; using one as a
// dedup key would let a *changing* malformed value re-announce the same payment,
// so we only ever key off a well-formed hash and skip the rest (#655 review).
const PAYMENT_HASH_RE = /^[0-9a-f]{64}$/i;
export function isValidPaymentHash(hash: string | undefined | null): hash is string {
  return typeof hash === 'string' && PAYMENT_HASH_RE.test(hash);
}

// Returns the settled, incoming transactions whose (well-formed) payment_hash
// isn't in `seenHashes` — i.e. genuinely new receives to announce.
//
// Detecting receives by *transaction identity* (payment_hash) rather than by
// balance-diffing is what stops a single payment being announced repeatedly:
// a flapping / stale relay makes the balance bounce (e.g. 1011 → 1122 → 1011 →
// 1122), and a balance-diff detector re-fires "+111 received" on every upward
// bounce. Keyed by hash, the same payment is announced exactly once (#653).
//
// Callers seed `seenHashes` from the wallet's existing history on first sight so
// launch doesn't re-announce past payments.
export function pickNewReceipts(
  transactions: readonly WalletTransaction[],
  seenHashes: ReadonlySet<string>,
): NewReceipt[] {
  const fresh: NewReceipt[] = [];
  for (const tx of transactions) {
    if (tx.type !== 'incoming') continue;
    if (typeof tx.settled_at !== 'number') continue;
    if (!isValidPaymentHash(tx.paymentHash)) continue;
    if (seenHashes.has(tx.paymentHash)) continue;
    fresh.push({ paymentHash: tx.paymentHash, amountSats: tx.amount, settledAt: tx.settled_at });
  }
  return fresh;
}

// All payment_hashes of settled incoming txns (well-formed only) — used to seed
// the seen-set on first sight of a wallet (silent baseline: no launch re-announce).
export function settledIncomingHashes(transactions: readonly WalletTransaction[]): Set<string> {
  const hashes = new Set<string>();
  for (const tx of transactions) {
    if (
      tx.type === 'incoming' &&
      typeof tx.settled_at === 'number' &&
      isValidPaymentHash(tx.paymentHash)
    ) {
      hashes.add(tx.paymentHash);
    }
  }
  return hashes;
}
