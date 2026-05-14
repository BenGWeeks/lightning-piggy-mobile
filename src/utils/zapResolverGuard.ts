/**
 * Pure decision helpers for the zap-sender resolver's "should I even
 * run?" gate. Extracted from `WalletContext.resolveZapSendersForWallet`
 * so the skip / run / force logic is unit-testable without standing up
 * the whole provider (#526).
 *
 * The resolver is expensive (relay round-trips + event processing) and
 * runs after every transaction-list refresh — including the automatic
 * one on cold start. A *fingerprint* of the pending work lets us skip
 * the pass entirely when nothing has changed since the last successful
 * run. Persisting the fingerprint (see `zapResolverFingerprintStorage`)
 * extends that skip across cold starts; a `force` flag lets an explicit
 * pull-to-refresh bypass it and always do a full pass.
 */

/** Minimal shape the fingerprint needs off a pending transaction. */
export interface PendingTxLike {
  tx: {
    paymentHash?: string | null;
    bolt11?: string | null;
    created_at?: number | null;
  };
  idx: number;
}

/** The two values that together identify "the same work as last time". */
export interface ResolverFingerprint {
  /** Stable hash of the pending-tx set (index + best available id). */
  pendingHash: string;
  /** `zapCounterpartyStorage` write version — bumps when a resolution
   *  lands, so a fingerprint match also means the cache is unchanged. */
  storageVersion: number;
}

/**
 * Deterministic hash of the pending-transaction set. Two calls with the
 * same pending list (same order, same ids) produce the same string;
 * any add / remove / reorder changes it. Uses `idx` plus the best
 * available identifier (`paymentHash` → `bolt11` → `created_at`) so
 * cached txs that predate bolt11 capture still contribute a stable key.
 */
export const computePendingHash = (pending: PendingTxLike[]): string =>
  pending
    .map(({ tx, idx }) => `${idx}:${tx.paymentHash ?? tx.bolt11 ?? tx.created_at ?? ''}`)
    .join('|');

/**
 * Should the resolver skip its pass entirely?
 *
 * Skips only when ALL of:
 *  - not a forced (pull-to-refresh) run,
 *  - a previous fingerprint exists,
 *  - the pending-tx hash is unchanged, AND
 *  - the counterparty-storage version is unchanged.
 *
 * `force` short-circuits to `false` — an explicit refresh always does a
 * full pass even if nothing looks different (a relay that was down last
 * time may be up now).
 */
export const shouldSkipResolve = (args: {
  current: ResolverFingerprint;
  persisted: ResolverFingerprint | null;
  force: boolean;
}): boolean => {
  const { current, persisted, force } = args;
  if (force) return false;
  if (!persisted) return false;
  return (
    persisted.pendingHash === current.pendingHash &&
    persisted.storageVersion === current.storageVersion
  );
};
