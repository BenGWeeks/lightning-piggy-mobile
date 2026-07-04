import type { Filter } from 'nostr-tools/filter';
import { pool, trackRelays } from './nostrService';

// Relay-layer fetch helpers for NIP-25 reactions + NIP-09 retractions (#205).
// Extracted from nostrService (file-size cap) — a thin leaf over the shared
// SimplePool so the reaction data path is independently readable.

/**
 * Fetch all NIP-25 (kind 7) reaction events that target any of the given
 * event ids. Uses `#e` so the relay does the indexing — much cheaper than
 * grabbing every kind-7 from the reactor and filtering client-side.
 *
 * Hard-capped at 1000 results to keep a degenerate "react-spam" bubble
 * from blowing through the JS heap; in practice DM threads carry tens of
 * reactions, not thousands. Returns `[]` on any timeout / relay error
 * (callers fall back to "no reactions known").
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
  if (allRelays.length === 0) return [];
  trackRelays(allRelays);
  const filter: Filter = {
    kinds: [7],
    '#e': targetEventIds,
    limit: 1000,
  };
  // `maxWait` closes the sub if EOSE never arrives — same terminating
  // pattern the rest of nostrService uses (the old `withTimeout` race left
  // the sub open). Returns `[]` on relay error (caller degrades gracefully).
  let events: Awaited<ReturnType<typeof pool.querySync>>;
  try {
    events = await pool.querySync(allRelays, filter, { maxWait: 10000 });
  } catch {
    return [];
  }
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
  if (allRelays.length === 0) return [];
  trackRelays(allRelays);
  const filter: Filter = {
    kinds: [5],
    '#e': reactionEventIds,
    limit: 1000,
  };
  let events: Awaited<ReturnType<typeof pool.querySync>>;
  try {
    events = await pool.querySync(allRelays, filter, { maxWait: 10000 });
  } catch {
    return [];
  }
  return events.map((e) => ({
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    tags: e.tags,
  }));
}
