/**
 * Per-wallet relay-health bookkeeping for NWC (Nostr Wallet Connect).
 *
 * Extracted from `nwcService` (#785) so the service stays under the file-size
 * cap and so the health signal can be unit-tested in isolation. Tracks two
 * independent back-off mechanisms keyed by walletId:
 *
 *  1. **Reply-timeout cooldown** (`relayCooldownUntil`) — a relay that stops
 *     answering NIP-47 requests (reply-timeout / connection error) is parked
 *     with an escalating back-off so reconnect/poll callers stop hammering a
 *     dead relay every tick (#654/#656). ANY answered request clears it.
 *
 *  2. **Rate-limit back-off** (`relayRateLimitUntil`) — when the relay itself
 *     pushes back with a `rate-limited` / `too many` / `slow down` style
 *     rejection (e.g. CoinOS under publish flood, #785), we park it on its own
 *     escalating timer. CRITICALLY this is NOT cleared by a successful read:
 *     rate-limiting is about publish *volume*, not backend health, so a lucky
 *     answered request must not reset the back-off. It clears only when its own
 *     timer lapses.
 */

import { isConnectionError, isReplyTimeoutError } from './nwcErrors';

// Per-wallet count of consecutive NIP-47 requests that got no answer from the
// relay (reply-timeout / connection error). A WebSocket can stay `connected`
// while the relay hangs or the link dies (no clean close → TCP lingers in
// ESTABLISHED for ~2h), so transport state alone reports a dead relay as
// "Connected" (#654). isWalletConnected() treats a run of unanswered requests
// as not-connected so the UI is honest and the reconnect path kicks in.
const relayFailures = new Map<string, number>();
// Per-wallet timestamp until which a dead/timing-out relay is "parked" — once it
// looks dead we back off with an escalating cooldown instead of retrying every
// reconnect/poll tick (the churn behind the lag when a relay goes offline, #656).
const relayCooldownUntil = new Map<string, number>();
// Per-wallet rate-limit back-off: timestamp until which the relay is parked
// because it told us to slow down, plus a strike count driving the escalation.
// Tracked separately from the reply-timeout cooldown because a successful read
// must NOT clear it (#785).
const relayRateLimitUntil = new Map<string, number>();
const relayRateLimitStrikes = new Map<string, number>();

export const RELAY_DEAD_AFTER_FAILURES = 3;
export const RELAY_COOLDOWN_BASE_MS = 30_000;
export const RELAY_COOLDOWN_MAX_MS = 5 * 60_000;

/**
 * Does this error look like the relay rate-limiting / throttling / temp-banning
 * us? CoinOS's relay returns `rate-limited` when flooded with retries; other
 * relays phrase it as "too many", "slow down", "blocked", etc. Matching this
 * lets us back off publish volume instead of discarding the signal and showing
 * a green "Connected" while every request times out (#785).
 */
export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /rate.?limit|too many|too fast|slow down|temp.?ban|throttl|blocked/i.test(msg);
}

/**
 * Reset the failure count AND clear the reply-timeout cooldown — on a fresh
 * connect or any answered request.
 *
 * Deliberately does NOT touch the rate-limit back-off: that's about publish
 * volume, not whether the relay just answered a read, so a lucky successful
 * request must not reset it (#785). The rate-limit timer clears itself in
 * `isRelayInCooldown` once it lapses.
 */
export function markRelayResponsive(walletId: string): void {
  relayFailures.set(walletId, 0);
  relayCooldownUntil.delete(walletId);
}

/**
 * Record the outcome of a NIP-47 request against its relay-health counter.
 * Only a reply-timeout / connection error (the relay never answered) counts
 * toward "dead". ANY answer resets it — including a wallet-level error such as
 * "method not supported" (NWC wallets that don't implement `get_balance`) or
 * "insufficient funds". So this is capability-agnostic: it keys off whether the
 * relay *responded*, not which method succeeded, and never false-disconnects a
 * wallet that simply lacks a method (#654). Past the dead threshold, park the
 * relay with an escalating backoff (#656).
 */
export function recordRelayOutcome(walletId: string, error?: unknown): void {
  if (error !== undefined && (isReplyTimeoutError(error) || isConnectionError(error))) {
    const failures = (relayFailures.get(walletId) ?? 0) + 1;
    relayFailures.set(walletId, failures);
    if (failures >= RELAY_DEAD_AFTER_FAILURES) {
      const backoff = Math.min(
        RELAY_COOLDOWN_BASE_MS * 2 ** (failures - RELAY_DEAD_AFTER_FAILURES),
        RELAY_COOLDOWN_MAX_MS,
      );
      relayCooldownUntil.set(walletId, Date.now() + backoff);
    }
  } else {
    markRelayResponsive(walletId);
  }
}

/**
 * Park the relay because it rate-limited us. Each strike doubles the back-off
 * (30s, 60s, 120s, … capped at 5 min). Unlike the reply-timeout cooldown this
 * is NOT cleared by a successful read — only by its own timer lapsing (#785).
 */
export function recordRateLimited(walletId: string): void {
  const strikes = (relayRateLimitStrikes.get(walletId) ?? 0) + 1;
  relayRateLimitStrikes.set(walletId, strikes);
  const backoff = Math.min(RELAY_COOLDOWN_BASE_MS * 2 ** (strikes - 1), RELAY_COOLDOWN_MAX_MS);
  relayRateLimitUntil.set(walletId, Date.now() + backoff);
}

/**
 * True while a relay is parked — either because it stopped answering
 * (reply-timeout cooldown, #656) OR because it rate-limited us (#785).
 * reconnect/poll callers should skip it until the cooldown expires rather than
 * hammering it every tick.
 */
export function isRelayInCooldown(walletId: string): boolean {
  const now = Date.now();
  let parked = false;

  const until = relayCooldownUntil.get(walletId);
  if (until !== undefined) {
    if (now >= until) {
      // Expired — drop the entry so the Map can't grow unbounded.
      relayCooldownUntil.delete(walletId);
    } else {
      parked = true;
    }
  }

  const rlUntil = relayRateLimitUntil.get(walletId);
  if (rlUntil !== undefined) {
    if (now >= rlUntil) {
      // The rate-limit back-off clears only on its own timer — drop both the
      // timestamp and the strikes so a recovered relay starts fresh AND the
      // Maps don't retain a key forever for any wallet that was ever throttled
      // (#787 review). A missing strikes entry reads as 0 in `recordRateLimited`.
      relayRateLimitUntil.delete(walletId);
      relayRateLimitStrikes.delete(walletId);
    } else {
      parked = true;
    }
  }

  return parked;
}

/**
 * Has the relay stopped answering enough requests to be considered dead? Used
 * by `isWalletConnected` — transport "connected" can lie, so a run of
 * unanswered requests reads as not-connected (#654).
 */
export function isRelayDead(walletId: string): boolean {
  return (relayFailures.get(walletId) ?? 0) >= RELAY_DEAD_AFTER_FAILURES;
}

export type WalletConnectionHealth = 'responsive' | 'degraded' | 'disconnected';

/**
 * Tri-state health for the wallet card (#786):
 *  - `disconnected` — the WebSocket isn't connected;
 *  - `degraded` — connected but the relay is parked (cooldown/rate-limit) OR
 *    has recent reply-timeouts; shown as amber "Not responding". This is a LIVE
 *    read — it clears to `responsive` as soon as a request answers, since
 *    `markRelayResponsive` zeroes `relayFailures`;
 *  - `responsive` — connected and answering.
 */
export function getWalletHealth(walletId: string, isWsConnected: boolean): WalletConnectionHealth {
  if (!isWsConnected) return 'disconnected';
  if (isRelayInCooldown(walletId) || (relayFailures.get(walletId) ?? 0) > 0) {
    return 'degraded';
  }
  return 'responsive';
}
