import type { WalletTransaction } from '../types/wallet';

// Pure, testable shaping for the transaction-history list. The component
// (TransactionList) owns presentation + live profile/zap lookups; this module
// owns the order-independent data transforms: sort newest-first (pending up
// top), window the array for incremental "infinite scroll", and flatten the
// visible window into day-grouped rows for a FlatList.

export const INITIAL_PAGE_SIZE = 20;
export const PAGE_SIZE = 20;

export type ItemRow = { kind: 'tx'; tx: WalletTransaction; key: string };
export type HeaderRow = { kind: 'header'; label: string; key: string };
export type TxRow = ItemRow | HeaderRow;

// Build a deterministic key for a transaction row. Prefers settled-payment
// identifiers, falling back to on-chain txid, then bolt11, then a composite of
// the stable shape fields so pending rows still get distinct keys.
// Self-payments produce two entries with the same paymentHash / bolt11
// (incoming + outgoing leg), so always include `tx.type` to disambiguate.
export function txKey(tx: WalletTransaction, fallbackIndex: number): string {
  if (tx.paymentHash) return `ph:${tx.type}:${tx.paymentHash}`;
  if (tx.txid) return `tx:${tx.type}:${tx.txid}`;
  if (tx.bolt11) return `b11:${tx.type}:${tx.bolt11}`;
  return `fb:${tx.type}:${tx.created_at ?? tx.settled_at ?? 'pending'}:${tx.amount}:${fallbackIndex}`;
}

// Sort: pending (no timestamp) first, then newest first. Returns a new array;
// never mutates the input.
export function sortTransactions(transactions: WalletTransaction[]): WalletTransaction[] {
  return [...transactions].sort((a, b) => {
    // Nullish coalescing (not `||`) so a legitimate `0` (epoch) timestamp is
    // kept rather than falling through to the next field; only null/undefined
    // counts as "missing" (pending) and sorts to the top.
    const aTime = a.settled_at ?? a.created_at;
    const bTime = b.settled_at ?? b.created_at;
    const aMissing = aTime == null;
    const bMissing = bTime == null;
    if (aMissing && bMissing) return 0;
    if (aMissing) return -1;
    if (bMissing) return 1;
    return bTime - aTime;
  });
}

// How many transactions to render after `pagesLoaded` pages have been reached.
// Page 1 is INITIAL_PAGE_SIZE; each subsequent page adds PAGE_SIZE.
export function visibleCountForPages(pagesLoaded: number): number {
  if (pagesLoaded <= 1) return INITIAL_PAGE_SIZE;
  return INITIAL_PAGE_SIZE + (pagesLoaded - 1) * PAGE_SIZE;
}

// Are there more transactions beyond what the current page count reveals?
export function hasMoreTransactions(total: number, pagesLoaded: number): boolean {
  return total > visibleCountForPages(pagesLoaded);
}

// Advance the page counter when the user scrolls near the bottom. Caps at the
// page that fully reveals `total`, so we never increment endlessly past the end
// (which would keep `hasMore` false but churn state on every onEndReached).
export function nextPage(total: number, pagesLoaded: number): number {
  if (!hasMoreTransactions(total, pagesLoaded)) return pagesLoaded;
  return pagesLoaded + 1;
}

// Window an already-sorted array down to the visible page count.
export function windowTransactions(
  sorted: WalletTransaction[],
  pagesLoaded: number,
): WalletTransaction[] {
  return sorted.slice(0, visibleCountForPages(pagesLoaded));
}

// Flatten a visible window into a mixed list of day headers + tx rows. Pending
// entries (no timestamp) get a "Pending" header so they still group visually.
// `formatDayHeader` is injected so the locale-aware formatting stays in the
// component layer and this module remains pure + trivially testable.
export function buildTransactionRows(
  visible: WalletTransaction[],
  formatDayHeader: (ts: number) => string,
): TxRow[] {
  const rows: TxRow[] = [];
  let currentDayKey: string | null = null;
  visible.forEach((tx, fallbackIndex) => {
    // Nullish coalescing + explicit null check so a `0` (epoch) timestamp is a
    // real day, not grouped under "Pending"; only null/undefined is missing.
    const ts = tx.settled_at ?? tx.created_at;
    const dayKey = ts != null ? new Date(ts * 1000).toDateString() : '__pending__';
    if (dayKey !== currentDayKey) {
      rows.push({
        kind: 'header',
        label: ts != null ? formatDayHeader(ts) : 'Pending',
        key: `h:${dayKey}`,
      });
      currentDayKey = dayKey;
    }
    rows.push({ kind: 'tx', tx, key: txKey(tx, fallbackIndex) });
  });
  return rows;
}
