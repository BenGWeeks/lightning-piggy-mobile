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
 * Merge zap-resolver results (keyed by transaction index) into a transaction
 * list. Returns `null` when no row's attribution actually changes (#1014): a
 * forced pass returns null for every unattributed tx it re-checked, and
 * rewriting those would rebuild the array and re-render every visible row.
 */
export function applyResolverResults(
  transactions: readonly WalletTransaction[],
  resultsByIdx: ReadonlyMap<number, ZapCounterpartyInfo | null>,
): WalletTransaction[] | null {
  let changed = false;
  const updated = transactions.map((tx, i) => {
    if (!resultsByIdx.has(i)) return tx;
    const next = resultsByIdx.get(i) ?? null;
    if (next === null && (tx.zapCounterparty ?? null) === null) return tx;
    changed = true;
    return { ...tx, zapCounterparty: next };
  });
  return changed ? updated : null;
}
