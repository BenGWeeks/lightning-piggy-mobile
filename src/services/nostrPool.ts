import { SimplePool } from 'nostr-tools/pool';

/**
 * Shared connection-pool singleton, kept in its own dependency-free module.
 *
 * Feature-specific modules (e.g. `nostrProfileBatch`, `nostrPlacesPublisher`)
 * share this single set of relay WebSockets rather than spinning up parallel
 * `SimplePool` instances — each pool maintains its own sockets per relay, so
 * duplication adds real connection cost. Living here (rather than in
 * `nostrService`) lets those modules import the pool WITHOUT forming an import
 * cycle back to the large `nostrService` surface.
 *
 * `nostrService` imports this same instance, applies its custom fast-path
 * `pool.verifyEvent`, and re-exports `pool` / `trackRelays` for back-compat.
 */
export const pool = new SimplePool();

// Every relay we've opened a subscription against — tracked so `cleanup()`
// can close them all.
export const connectedRelays = new Set<string>();

// Track all relays we connect to for proper cleanup.
export function trackRelays(relays: string[]): void {
  relays.forEach((r) => connectedRelays.add(r));
}
