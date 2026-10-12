import { isOptimisticReactionId, type ReactionRecord } from './reactions';

export interface ConversationReactionSnapshot {
  records: ReactionRecord[];
  retractions: Map<string, Set<string>>;
}

// Warm opens must not wait for relay EOSE / another MLS history read. Account
// and protocol/group are part of the caller's key. Bound both retained threads
// and events; pending local publishes are never resurrected by reopening.
const snapshots = new Map<string, ConversationReactionSnapshot>();
const MAX_THREADS = 30;
const MAX_EVENTS = 2000;

export function readConversationReactions(key: string | null): ConversationReactionSnapshot {
  return (key && snapshots.get(key)) || { records: [], retractions: new Map() };
}

export function cacheConversationReactions(
  key: string | null,
  snapshot: ConversationReactionSnapshot,
) {
  if (!key) return;
  snapshots.delete(key);
  snapshots.set(key, {
    records: snapshot.records
      .filter(
        (r) =>
          !isOptimisticReactionId(r.id) &&
          !snapshot.retractions.get(r.id.toLowerCase())?.has(r.reactorPubkey),
      )
      .slice(-MAX_EVENTS),
    retractions: new Map(
      [...snapshot.retractions].slice(-MAX_EVENTS).map(([id, authors]) => [id, new Set(authors)]),
    ),
  });
  while (snapshots.size > MAX_THREADS) snapshots.delete(snapshots.keys().next().value!);
}
