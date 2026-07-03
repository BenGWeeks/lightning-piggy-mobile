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

// Whether a wallet needs its announced-receipt baseline seeded now.
//
// A wallet is baselined exactly once — the first time we have its real history
// in hand (launch hydration from cache, identity switch, or the first
// `fetchTransactionsForWallet`). `existingBaseline` is the per-wallet entry from
// the seen-set map: `undefined` means "never baselined". The receive detector
// must NOT baseline off the *current* in-state txns, because a freshly-added
// NWC wallet first appears with an empty tx list; baselining empty there would
// let the later fetched history announce a stale receive on the user's first
// refresh (the empty-baseline race, #725). So baselining is owned by the fetch
// (which has the real, fetched history) and gated on this predicate.
export function shouldSeedBaseline(
  existingBaseline: ReadonlySet<string> | undefined,
): existingBaseline is undefined {
  return existingBaseline === undefined;
}

// A new receipt tagged with which wallet (and label) it belongs to — the unit
// the receive detector picks a single winner from across all wallets.
export interface AnnouncedReceipt extends NewReceipt {
  walletId: string;
  walletLabel: string;
}

// Pick the newer of two candidate receipts deterministically (latest
// settledAt wins). The overlay shows ONE payment per render, so when several
// wallets each surface a fresh receive in the same tick we announce only the
// most recent — extracted so the tie-break is unit-testable (#859, #828).
export function pickNewerReceipt(
  current: AnnouncedReceipt | null,
  candidate: AnnouncedReceipt,
): AnnouncedReceipt {
  if (!current || candidate.settledAt > current.settledAt) return candidate;
  return current;
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
