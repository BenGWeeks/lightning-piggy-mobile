import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  WALLET_FRESH_MS,
  createWalletRefreshScheduler,
  type WalletFetcher,
  type WalletRefreshScheduler,
} from '../utils/walletRefreshScheduler';

interface Options {
  /** The wallet whose card is active in the carousel (`null` = none / add card). */
  activeWalletId: string | null;
  /**
   * Whether the active wallet is reachable (NWC `isConnected`; always true for
   * on-chain). A change re-runs activation, so a fetch that failed while the
   * wallet was disconnected is retried as soon as it reconnects.
   */
  available: boolean;
  /** Fetches one wallet; resolves `true` when a fresh list was committed. */
  fetchWallet: WalletFetcher;
  /** Wallets to warm after `walletId` loads, nearest first (read when prefetching). */
  getNeighbours?: (walletId: string) => readonly string[];
  /** Per-wallet freshness window (read when deciding). */
  freshMsFor?: (walletId: string) => number;
}

/**
 * Keeps the active wallet's transactions (and its neighbours') fresh as cards
 * become active (#1304), using the debounce, freshness and prefetch rules in
 * `walletRefreshScheduler`. The cached list renders from memory immediately;
 * this only drives background refreshes. Returns the active wallet's loading
 * state and a forced `refreshNow` for pull-to-refresh.
 *
 * Re-renders only when a fetch starts, settles or is scheduled or cancelled,
 * never per relay event.
 */
export function useActiveWalletRefresh({
  activeWalletId,
  available,
  fetchWallet,
  getNeighbours,
  freshMsFor,
}: Options): {
  /** The active wallet's refresh is due (debouncing) or fetching. */
  isLoading: boolean;
  /** A fetch for the active wallet is actually running (or queued). */
  isFetching: boolean;
  refreshNow: (walletId: string) => Promise<boolean>;
} {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // Latest fetcher through a ref, so the scheduler (created once) never calls a
  // stale closure and a new fetcher identity doesn't re-trigger activation.
  const fetchRef = useRef(fetchWallet);
  fetchRef.current = fetchWallet;
  const neighboursRef = useRef(getNeighbours);
  neighboursRef.current = getNeighbours;
  const freshRef = useRef(freshMsFor);
  freshRef.current = freshMsFor;

  const schedulerRef = useRef<WalletRefreshScheduler | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createWalletRefreshScheduler({
      fetch: (id, opts) => fetchRef.current(id, opts),
      getNeighbours: (id) => neighboursRef.current?.(id) ?? [],
      freshMsFor: (id) => freshRef.current?.(id) ?? WALLET_FRESH_MS,
      onChange: bump,
    });
  }
  const scheduler = schedulerRef.current;

  // Unmount cancels a pending (debouncing) fetch. Not a permanent dispose, so
  // StrictMode's cleanup→setup replay still re-activates the card.
  useEffect(() => () => scheduler.activate(null), [scheduler]);

  useEffect(() => {
    scheduler.activate(activeWalletId);
  }, [scheduler, activeWalletId, available]);

  const refreshNow = useCallback((walletId: string) => scheduler.refreshNow(walletId), [scheduler]);

  return {
    isLoading: scheduler.isLoading(activeWalletId),
    isFetching: scheduler.isFetching(activeWalletId),
    refreshNow,
  };
}
