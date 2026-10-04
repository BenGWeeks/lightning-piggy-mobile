import type { WalletState, WalletTransaction, ZapCounterpartyInfo } from '../types/wallet';

/**
 * Apply a partial field update to one wallet in the `wallets` array, with a
 * **no-op bail-out**: when every updated field is `Object.is`-equal to what's
 * already stored, return the SAME array identity so React doesn't re-render.
 *
 * The `WalletContext` value depends on `wallets`, so any new array identity
 * re-renders every `useWallet()` consumer (HomeScreen, WalletCarousel,
 * TransactionList…). Balance checks run every few seconds during a receive
 * window; before this guard each one produced a full-consumer re-render wave
 * even when the polled balance was unchanged.
 *
 * Object identity is per field: `transactions` arrays are always freshly built
 * by callers, so genuine list updates still commit — only true field-level
 * no-ops bail. Returns `prev` unchanged when the wallet isn't found.
 */
export function mergeWalletUpdate(
  prev: WalletState[],
  walletId: string,
  updates: Partial<WalletState>,
): WalletState[] {
  const current = prev.find((w) => w.id === walletId);
  if (
    !current ||
    (Object.keys(updates) as (keyof WalletState)[]).every((k) => Object.is(current[k], updates[k]))
  ) {
    return prev;
  }
  return prev.map((w) => (w.id === walletId ? { ...w, ...updates } : w));
}

/**
 * Merge zap-resolver results (keyed by captured transaction) into a transaction
 * list. Returns `null` when no row's attribution actually changes (#1014): a
 * forced pass returns null for every unattributed tx it re-checked, and
 * rewriting those would rebuild the array and re-render every visible row.
 */
export function applyResolverResults(
  transactions: readonly WalletTransaction[],
  results: ReadonlyMap<WalletTransaction, ZapCounterpartyInfo | null>,
): WalletTransaction[] | null {
  let changed = false;
  const sources = [...results.keys()];
  const updated = transactions.map((tx) => {
    // Prefer object identity for hashless cached rows; stable identifiers also
    // survive a refresh replacing objects while the resolver is in flight.
    const source = sources.find(
      (candidate) =>
        candidate === tx ||
        (candidate.type === tx.type &&
          ((tx.paymentHash && candidate.paymentHash === tx.paymentHash) ||
            (tx.txid && candidate.txid === tx.txid) ||
            (tx.bolt11 && candidate.bolt11 === tx.bolt11))),
    );
    if (!source) return tx;
    const next = results.get(source) ?? null;
    if (next === null && (tx.zapCounterparty ?? null) === null) return tx;
    changed = true;
    return { ...tx, zapCounterparty: next };
  });
  return changed ? updated : null;
}
