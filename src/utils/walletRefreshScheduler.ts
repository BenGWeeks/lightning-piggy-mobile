/**
 * Decides when Home refetches a wallet's transactions as its card becomes
 * active in the carousel (#1304). Pure (no React) so the rules are unit-tested:
 *
 * - **Debounce**: a card must stay active for `settleMs` (default 300 ms)
 *   before it fetches, so flicking through cards doesn't fire a fetch storm.
 * - **Freshness**: a wallet that loaded successfully within `freshMs` (default
 *   30 s) isn't refetched on activation. Pull-to-refresh (`refreshNow`)
 *   bypasses both rules.
 * - **Failures don't count**: only a successful fetch stamps the wallet as
 *   fresh (a failure clears an earlier stamp), so a failed or timed-out fetch is retried the next time the card is
 *   activated (or its connection comes back), not stranded until
 *   pull-to-refresh.
 * - **One fetch per wallet at a time**: activating a wallet that's already
 *   fetching doesn't start another; if that fetch then fails, it's retried once
 *   (debounced). Pull-to-refresh queues behind a running fetch, so the newest
 *   result always commits last.
 *
 * Cached transactions are already in wallet state from launch hydration, so
 * the card shows them straight away. This only schedules the background
 * refresh, and reports "loading" (due or in flight) for the small indicator.
 */

export const WALLET_SWIPE_SETTLE_MS = 300;
export const WALLET_FRESH_MS = 30_000;

export type WalletFetcher = (walletId: string, opts: { force: boolean }) => Promise<boolean>;

export interface WalletRefreshSchedulerOptions {
  /** Resolves `true` when a fresh list was committed. A rejection counts as `false`. */
  fetch: WalletFetcher;
  /** Called whenever any wallet's loading state (due or in flight) flips. */
  onChange?: () => void;
  settleMs?: number;
  freshMs?: number;
  now?: () => number;
}

export interface WalletRefreshScheduler {
  /** A card became active, or its connection state changed. `null` = no wallet card. */
  activate(walletId: string | null): void;
  /** Pull-to-refresh: fetch now with `force`, ignoring debounce and freshness. */
  refreshNow(walletId: string): Promise<boolean>;
  /** True while a fetch for this wallet is due (debouncing) or in flight. */
  isLoading(walletId: string | null): boolean;
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
  settleMs = WALLET_SWIPE_SETTLE_MS,
  freshMs = WALLET_FRESH_MS,
  now = Date.now,
}: WalletRefreshSchedulerOptions): WalletRefreshScheduler {
  const lastLoadedAt = new Map<string, number>();
  // Fetches are serialised per wallet: `chains` holds the tail of each wallet's
  // queue and `busy` counts its queued + running fetches. Serialising means a
  // pull-to-refresh queued behind a background fetch always commits last, and
  // the latest outcome is the one that sets (or clears) freshness.
  const chains = new Map<string, Promise<void>>();
  const busy = new Map<string, number>();
  // Wallets activated again while a fetch was running: retried if it fails.
  const retryIfFailed = new Set<string>();
  let activeId: string | null = null;
  let pendingId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const notify = (): void => {
    onChange?.();
  };

  const cancelPending = (): boolean => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const hadPending = pendingId !== null;
    pendingId = null;
    return hadPending;
  };

  const isDue = (walletId: string): boolean =>
    !busy.has(walletId) && !isWalletFresh(lastLoadedAt.get(walletId), now(), freshMs);

  const attempt = async (walletId: string, force: boolean): Promise<boolean> => {
    let ok = false;
    try {
      ok = await fetch(walletId, { force });
    } catch {
      ok = false;
    }
    // Only a success counts as loaded; a failure clears an older success so
    // the next activation retries instead of trusting a stale stamp.
    if (ok) lastLoadedAt.set(walletId, now());
    else lastLoadedAt.delete(walletId);
    return ok;
  };

  const schedule = (walletId: string): void => {
    pendingId = walletId;
    timer = setTimeout(() => {
      timer = null;
      pendingId = null;
      // Re-check: a pull-to-refresh may have loaded it during the settle wait.
      if (!isDue(walletId)) {
        notify();
        return;
      }
      void enqueue(walletId, false);
    }, settleMs);
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
      if (ok || left > 0) {
        if (ok) retryIfFailed.delete(walletId);
      } else if (retryIfFailed.delete(walletId) && activeId === walletId && pendingId === null) {
        // It was re-activated mid-fetch (e.g. its NWC connection came back)
        // and that fetch failed: retry once, debounced like any activation.
        schedule(walletId);
      }
      notify();
      return ok;
    });
  };

  return {
    activate(walletId) {
      activeId = walletId;
      const hadPending = cancelPending();
      if (walletId !== null && busy.has(walletId)) retryIfFailed.add(walletId);
      if (walletId === null || !isDue(walletId)) {
        if (hadPending) notify();
        return;
      }
      schedule(walletId);
      notify();
    },

    refreshNow(walletId) {
      if (pendingId === walletId) cancelPending();
      return enqueue(walletId, true);
    },

    isLoading(walletId) {
      if (walletId === null) return false;
      return pendingId === walletId || busy.has(walletId);
    },
  };
}
