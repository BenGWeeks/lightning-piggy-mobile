/**
 * Swipe-latency probe for the Home wallet carousel (#1304): how long after a
 * card *settles* does Home commit that wallet's transaction list?
 *
 * - The carousel calls `markWalletSwipeSettled(id)` when its scroll comes to
 *   rest on a card.
 * - Home calls `noteWalletListCommitted(id)` after each commit that shows a
 *   wallet's list.
 *
 * Per swipe it logs `[Perf] WalletSwipe switch→list <id> <n>ms` (card switched
 * mid-swipe → Home committed that wallet's list; the main metric) and
 * `settled→list` (scroll came to rest → list committed; 0 ms = already there).
 * The settle event queues behind Home's re-render on the JS thread, so
 * `settled→list` under-reports a slow render. Pulled
 * from logcat by `scripts/perf-wallet-swipe.sh` for a p50/p95. Same gating as
 * `perfLog` (dev builds, or `EXPO_PUBLIC_KEEP_PERF_LOGS=1`).
 */
import { perfLog } from './perfLog';

const ENABLED = __DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1';

let lastCommittedId: string | null = null;
let pending: { walletId: string; at: number } | null = null;
let requested: { walletId: string; at: number } | null = null;

const report = (walletId: string, ms: number): void =>
  perfLog(`WalletSwipe settled→list ${walletId.slice(0, 8)} ${Math.round(ms)}ms`);

/**
 * The carousel switched the active card (it crossed 50% mid-swipe). The JS
 * thread processes this BEFORE Home's re-render, unlike the settle event,
 * which queues behind that render, so `switch→list` is the honest lag metric.
 */
export function markWalletSwitchRequested(walletId: string): void {
  if (!ENABLED || lastCommittedId === walletId) return;
  if (requested?.walletId !== walletId) requested = { walletId, at: Date.now() };
}

export function markWalletSwipeSettled(walletId: string): void {
  if (!ENABLED) return;
  if (lastCommittedId === walletId) {
    pending = null;
    report(walletId, 0);
    return;
  }
  pending = { walletId, at: Date.now() };
}

export function noteWalletListCommitted(walletId: string | null): void {
  if (!ENABLED) return;
  lastCommittedId = walletId;
  if (walletId !== null && requested?.walletId === walletId) {
    perfLog(
      `WalletSwipe switch→list ${walletId.slice(0, 8)} ${Math.round(Date.now() - requested.at)}ms`,
    );
    requested = null;
  }
  if (walletId !== null && pending?.walletId === walletId) {
    report(walletId, Date.now() - pending.at);
    pending = null;
  }
}
