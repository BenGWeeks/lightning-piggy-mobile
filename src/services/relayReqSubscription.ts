import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';

type Relay = Awaited<ReturnType<AbstractSimplePool['ensureRelay']>>;
type Subscribe = (
  relay: Relay,
  filters: Parameters<Relay['subscribe']>[0],
  params: Parameters<Relay['subscribe']>[1],
) => { close: (reason?: string) => void };

/** Preserve raw EOSE/error semantics for authoritative reads, with pool accounting. */
export function subscribeRelayWithBudget(
  pool: Pick<AbstractSimplePool, 'ensureRelay'>,
  relay: Relay,
  filters: Parameters<Relay['subscribe']>[0],
  params: Parameters<Relay['subscribe']>[1],
) {
  const budgeted = pool as typeof pool & { subscribeRelay?: Subscribe };
  // Injected test/custom transports may lack a scheduler; both app pools have it.
  return budgeted.subscribeRelay
    ? budgeted.subscribeRelay(relay, filters, params)
    : relay.subscribe(filters, params);
}
