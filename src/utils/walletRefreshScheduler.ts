/**
 * Decides when Home refreshes wallets' transactions around the carousel
 * (#1304). Pure (no React) so the rules are unit-tested.
 *
 * Every wallet's cached list is already in memory (wallet state is hydrated
 * from the per-wallet `txs_<id>` cache at launch), so a card shows its own rows
 * the moment it becomes active. This only schedules *background* refreshes:
 *
 * - **Debounce**: work starts once a card has stayed active for `settleMs`
 *   (default 300 ms), so flicking through cards doesn't fire a fetch storm.
 * - **Freshness**: a wallet that loaded successfully within its freshness
 *   window (default 30 s; `freshMsFor` can widen it per wallet) isn't
 *   refetched. Pull-to-refresh (`refreshNow`) bypasses both rules.
 * - **Failures don't count**: only a success stamps a wallet fresh, and a
 *   failure clears an older stamp, so the next activation retries.
 * - **One fetch per wallet at a time**: re-activating a wallet that's fetching
 *   doesn't start another; if that fetch then fails it's retried once
 *   (debounced). Pull-to-refresh queues behind a running fetch, so the newest
 *   result always commits last.
 * - **Neighbour prefetch**: once the active card has loaded (or was already
 *   fresh), its neighbours (`getNeighbours`) are refreshed one at a time under
 *   the same freshness rule, so the next swipe is already up to date. A new
 *   activation stops the queue (a neighbour fetch already running finishes).
 */

export const WALLET_SWIPE_SETTLE_MS = 300;
export const WALLET_FRESH_MS = 30_000;

export type WalletFetcher = (walletId: string, opts: { force: boolean }) => Promise<boolean>;

export interface WalletRefreshSchedulerOptions {
  /** Resolves `true` when a fresh list was committed. A rejection counts as `false`. */
  fetch: WalletFetcher;
  /** Called whenever a wallet's due / fetching state flips. */
  onChange?: () => void;
  /** Wallets to prefetch after `walletId` loads, nearest first. Read at prefetch time. */
  getNeighbours?: (walletId: string) => readonly string[];
  /** Per-wallet freshness window; defaults to `freshMs`. */
  freshMsFor?: (walletId: string) => number;
  settleMs?: number;
  freshMs?: number;
  now?: () => number;
}

export interface WalletRefreshScheduler {
  /** A card became active, or its connection state changed. `null` = no wallet card. */
  activate(walletId: string | null): void;
  /** Pull-to-refresh: fetch now with `force`, ignoring debounce and freshness. */
  refreshNow(walletId: string): Promise<boolean>;
  /** True while this wallet's refresh is due (debouncing) or fetching. */
  isLoading(walletId: string | null): boolean;
  /** True while a fetch for this wallet is queued or running. */
  isFetching(walletId: string | null): boolean;
}

/** A wallet is fresh when it last loaded successfully less than `freshMs` ago. */
export function isWalletFresh(
  lastLoadedAt: number | undefined,
  now: number,
  freshMs: number = WALLET_FRESH_MS,
): boolean {
  return lastLoadedAt !== undefined && now - lastLoadedAt < freshMs;
}

export function createWalletRefreshScheduler({
  fetch,
  onChange,
  getNeighbours,
  freshMsFor,
  settleMs = WALLET_SWIPE_SETTLE_MS,
  freshMs = WALLET_FRESH_MS,
  now = Date.now,
}: WalletRefreshSchedulerOptions): WalletRefreshScheduler {
  const lastLoadedAt = new Map<string, number>();
  // Fetches are serialised per wallet: `chains` holds the tail of each wallet's
  // queue and `busy` counts its queued + running fetches, so the latest outcome
  // is the one that sets (or clears) freshness.
  const chains = new Map<string, Promise<void>>();
  const busy = new Map<string, number>();
  // Wallets re-activated while their fetch was running: retried if it fails.
  const retryIfFailed = new Set<string>();
  // Bumped on every activation; stale settle / prefetch work checks it.
  let generation = 0;
  let activeId: string | null = null;
  let dueId: string | null = null; // active wallet waiting out the debounce
  let timer: ReturnType<typeof setTimeout> | null = null;

  const notify = (): void => {
    onChange?.();
  };

  const isFresh = (walletId: string): boolean =>
    isWalletFresh(lastLoadedAt.get(walletId), now(), freshMsFor?.(walletId) ?? freshMs);

  const isDue = (walletId: string): boolean => !busy.has(walletId) && !isFresh(walletId);

  const cancelSettle = (): boolean => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const hadDue = dueId !== null;
    dueId = null;
    return hadDue;
  };

  const attempt = async (walletId: string, force: boolean): Promise<boolean> => {
    let ok = false;
    try {
      ok = await fetch(walletId, { force });
    } catch {
      ok = false;
    }
    if (ok) lastLoadedAt.set(walletId, now());
    else lastLoadedAt.delete(walletId);
    return ok;
  };

  const enqueue = (walletId: string, force: boolean): Promise<boolean> => {
    busy.set(walletId, (busy.get(walletId) ?? 0) + 1);
    notify();
    // Start at once when idle; otherwise queue behind the running fetch.
    const prev = chains.get(walletId);
    const result = prev ? prev.then(() => attempt(walletId, force)) : attempt(walletId, force);
    const tail = result.then(() => undefined);
    chains.set(walletId, tail);
    return result.then((ok) => {
      const left = (busy.get(walletId) ?? 1) - 1;
      if (left > 0) busy.set(walletId, left);
      else busy.delete(walletId);
      if (chains.get(walletId) === tail) chains.delete(walletId);
      if (ok) {
        retryIfFailed.delete(walletId);
      } else if (left === 0 && retryIfFailed.delete(walletId) && activeId === walletId) {
        // Re-activated mid-fetch (e.g. its NWC connection came back) and that
        // fetch failed: retry once, debounced like any activation (or by the
        // settle timer that re-activation already armed).
        if (timer === null) settle(walletId);
        else dueId = walletId;
      }
      notify();
      return ok;
    });
  };

  const prefetchNeighbours = async (walletId: string, gen: number): Promise<void> => {
    for (const id of getNeighbours?.(walletId) ?? []) {
      if (gen !== generation) return; // swiped on: stop the queue
      if (isDue(id)) await enqueue(id, false);
    }
  };

  // After the debounce: refresh the active wallet if it's due, wait for a
  // fetch already running, then warm its neighbours if it ended up loaded.
  const settle = (walletId: string): void => {
    const gen = generation;
    if (isDue(walletId)) dueId = walletId;
    timer = setTimeout(async () => {
      timer = null;
      const wasDue = dueId === walletId;
      dueId = null;
      if (gen !== generation) return;
      if (isDue(walletId)) {
        await enqueue(walletId, false);
      } else {
        if (wasDue) notify(); // a pull-to-refresh beat the debounce
        await chains.get(walletId);
      }
      if (gen === generation && isFresh(walletId)) await prefetchNeighbours(walletId, gen);
    }, settleMs);
  };

  return {
    activate(walletId) {
      generation += 1;
      activeId = walletId;
      const hadDue = cancelSettle();
      if (walletId === null) {
        if (hadDue) notify();
        return;
      }
      if (busy.has(walletId)) retryIfFailed.add(walletId);
      settle(walletId);
      if (hadDue || dueId !== null) notify();
    },

    refreshNow(walletId) {
      if (dueId === walletId) dueId = null;
      return enqueue(walletId, true);
    },

    isLoading(walletId) {
      if (walletId === null) return false;
      return dueId === walletId || busy.has(walletId);
    },

    isFetching(walletId) {
      return walletId !== null && busy.has(walletId);
    },
  };
}
