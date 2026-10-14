import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { subscribeRelayWithBudget } from './relayReqSubscription';
import { pool, trackRelays } from './nostrService';

// Relay-layer fetch helpers for NIP-25 reactions + NIP-09 retractions (#205).
// Extracted from nostrService (file-size cap) — a thin leaf over the shared
// SimplePool so the reaction data path is independently readable.

// querySync treats timeout/close as EOSE. Use individual subscriptions with
// our deadline BEFORE the library's synthetic EOSE deadline. Only actual EOSE
// from every requested relay makes this result authoritative.
async function queryAuthoritative(relays: string[], filter: Filter): Promise<Event[]> {
  if (relays.length === 0) throw new Error('No reaction read relays');
  const batches = await Promise.all(
    relays.map(async (url) => {
      const relay = await pool.ensureRelay(url, { connectionTimeout: 10000 });
      return new Promise<Event[]>((resolve, reject) => {
        const events: Event[] = [];
        let done = false;
        const finish = (error?: Error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          subscription.close();
          if (error) reject(error);
          else resolve(events);
        };
        const timer = setTimeout(() => finish(new Error('Reaction read timed out')), 10000);
        const subscription = subscribeRelayWithBudget(pool, relay, [filter], {
          eoseTimeout: 20000,
          onevent: (event) => events.push(event),
          oneose: () => finish(),
          onclose: (reason) => finish(new Error(reason)),
        });
      });
    }),
  );
  return [...new Map(batches.flat().map((event) => [event.id, event])).values()];
}

/**
 * Fetch all NIP-25 (kind 7) reaction events that target any of the given
 * event ids. Uses `#e` so the relay does the indexing — much cheaper than
 * grabbing every kind-7 from the reactor and filtering client-side.
 *
 * Hard-capped at 1000 results to keep a degenerate "react-spam" bubble
 * from blowing through the JS heap; in practice DM threads carry tens of
 * reactions, not thousands. Rejects on timeout / relay error so callers retain cached reactions.
 */
export async function fetchReactions(
  targetEventIds: string[],
  relays: string[],
): Promise<
  {
    id: string;
    pubkey: string;
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  }[]
> {
  if (targetEventIds.length === 0) return [];
  const allRelays = [...new Set(relays)];
  trackRelays(allRelays);
  const filter: Filter = {
    kinds: [7],
    '#e': targetEventIds,
    limit: 1000,
  };
  const events = await queryAuthoritative(allRelays, filter);
  return events.map((e) => ({
    id: e.id,
    pubkey: e.pubkey,
    kind: e.kind,
    content: e.content,
    created_at: e.created_at,
    tags: e.tags,
  }));
}

/**
 * Fetch NIP-09 (kind 5) deletion events that retract any of the given
 * reaction event ids. Used so a peer revoking their reaction (long-press
 * → tap-again-to-toggle) is reflected in the viewer's UI.
 *
 * NIP-09 enforcement: callers MUST verify each returned deletion's
 * `pubkey` matches the targeted reaction's reactor before applying — a
 * relay can't enforce that and we don't want a third party retracting
 * someone else's reaction.
 */
export async function fetchReactionDeletions(
  reactionEventIds: string[],
  relays: string[],
): Promise<
  {
    id: string;
    pubkey: string;
    created_at: number;
    tags: string[][];
  }[]
> {
  if (reactionEventIds.length === 0) return [];
  const allRelays = [...new Set(relays)];
  trackRelays(allRelays);
  const filter: Filter = {
    kinds: [5],
    '#e': reactionEventIds,
    limit: 1000,
  };
  const events = await queryAuthoritative(allRelays, filter);
  return events.map((e) => ({
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    tags: e.tags,
  }));
}
