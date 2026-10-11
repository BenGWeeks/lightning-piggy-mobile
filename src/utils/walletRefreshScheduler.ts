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
 *   fresh, so a failed or timed-out fetch is retried the next time the card is
 *   activated (or its connection comes back), not stranded until
 *   pull-to-refresh.
 * - **One fetch per wallet**: activating a wallet that's already fetching
 *   doesn't start a second fetch.
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
  // A counter, not a set: a pull-to-refresh can overlap a background fetch.
  const inFlight = new Map<string, number>();
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
    !inFlight.has(walletId) && !isWalletFresh(lastLoadedAt.get(walletId), now(), freshMs);

  const run = async (walletId: string, force: boolean): Promise<boolean> => {
    inFlight.set(walletId, (inFlight.get(walletId) ?? 0) + 1);
    notify();
    let ok = false;
    try {
      ok = await fetch(walletId, { force });
    } catch {
      ok = false;
    }
    if (ok) lastLoadedAt.set(walletId, now());
    const left = (inFlight.get(walletId) ?? 1) - 1;
    if (left > 0) inFlight.set(walletId, left);
    else inFlight.delete(walletId);
    notify();
    return ok;
  };

  return {
    activate(walletId) {
      const hadPending = cancelPending();
      if (walletId === null || !isDue(walletId)) {
        if (hadPending) notify();
        return;
      }
      pendingId = walletId;
      timer = setTimeout(() => {
        timer = null;
        pendingId = null;
        // Re-check: a pull-to-refresh may have loaded it during the settle wait.
        if (!isDue(walletId)) {
          notify();
          return;
        }
        void run(walletId, false);
      }, settleMs);
      notify();
    },

    refreshNow(walletId) {
      if (pendingId === walletId) cancelPending();
      return run(walletId, true);
    },

    isLoading(walletId) {
      if (walletId === null) return false;
      return pendingId === walletId || inFlight.has(walletId);
    },
  };
}
