import { SimplePool } from 'nostr-tools/pool';
import { withRelayHealth } from './healthAwarePool';
import { hydrateRelayHealth } from './relayHealth';

/** `SimplePool` that skips relays known to be dead (#1326, see ./healthAwarePool). */
class HealthAwarePool extends withRelayHealth(SimplePool) {}

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
export const pool: SimplePool = new HealthAwarePool();

// Load what we learned about dead relays last session, so they're skipped
// from the first query rather than after two more timeouts.
void hydrateRelayHealth();

// Every relay we've opened a subscription against — tracked so `cleanup()`
// can close them all.
export const connectedRelays = new Set<string>();

// Track all relays we connect to for proper cleanup.
export function trackRelays(relays: string[]): void {
  relays.forEach((r) => connectedRelays.add(r));
}
