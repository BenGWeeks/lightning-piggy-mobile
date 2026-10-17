// Reactions in a 1:1 NIP-17 chat (#1319, #1321): kind-7 / kind-5 rumors
// gift-wrapped to the peer and ourselves, never published publicly. They
// arrive through the normal DM ingest, which stores them as wireKind 7 / 5
// rows; this source reads those rows back and sends new ones.
//
// Public NIP-25 reactions to DM messages (what earlier Lightning Piggy builds
// sent) are still read, so existing reactions don't disappear. They arrive on
// the live channel after the stored ones, so slow relays never delay those.
// Retracting one also sends a public kind 5, asking relays to delete it.
//
// Same shape as the Marmot source, so useConversationReactions can use either.

import {
  deleteLocalDmRow,
  getConversationReactionRows,
  LOCAL_DM_ID_PREFIX,
  subscribeDmStorage,
  upsertDmMessages,
} from './dmDb';
import { directMessageRumorEventId } from './dmRumorId';
import {
  buildChatReactionDeletionRumor,
  buildChatReactionRumor,
  CHAT_DELETION_KIND,
  CHAT_REACTION_KIND,
  eTagTargets,
  serializeChatReactionRumor,
  storedChatReactionEvent,
  type ChatReactionEvent,
} from '../utils/nip17Reactions';

export interface ChatRumor {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface Nip17ReactionDeps {
  myPubkey: string;
  peerPubkey: string;
  /** Gift-wrap `rumor` to the peer (and our own inbox). True once a relay accepted it. */
  sendRumor: (rumor: ChatRumor) => Promise<boolean>;
  /** Public NIP-25 / NIP-09 reads and the public retraction, for older reactions. */
  publicReactions: {
    fetchReactionsForMessages: (ids: string[]) => Promise<ChatReactionEvent[]>;
    fetchReactionDeletions: (
      ids: string[],
    ) => Promise<{ id: string; pubkey: string; created_at: number; tags: string[][] }[]>;
    deleteReaction: (reactionEventId: string) => Promise<boolean>;
  };
}

export interface Nip17ReactionSource {
  fetchReactionsForMessages: (targetEventIds: string[]) => Promise<ChatReactionEvent[]>;
  fetchReactionDeletions: (reactionEventIds: string[]) => Promise<ChatReactionEvent[]>;
  publishReaction: (input: {
    emoji: string;
    targetEventId: string;
    targetAuthorPubkey: string;
    targetEventKind?: number;
  }) => Promise<string | null>;
  deleteReaction: (reactionEventId: string) => Promise<boolean>;
  /** Wrapped reactions / retractions stored after subscribing. Returns unsubscribe. */
  subscribe: (onEvent: (event: ChatReactionEvent) => void) => () => void;
}

/** The reaction backend for `myPubkey`'s NIP-17 chat with `peerPubkey`. */
export function nip17ReactionSource(deps: Nip17ReactionDeps): Nip17ReactionSource {
  const me = deps.myPubkey.toLowerCase();
  const peer = deps.peerPubkey.toLowerCase();
  // Only the two chat members can react in a 1:1 chat. Anything else is a
  // stranger who learned a message id; ignore it.
  const isMember = (pubkey: string) => {
    const p = pubkey.toLowerCase();
    return p === me || p === peer;
  };
  // Reaction ids that came from public relays: retracting one also needs a
  // public kind 5, or the leaked event stays up.
  const publicIds = new Set<string>();
  // The open thread's live listeners. Public reactions arrive through them,
  // so a slow or dead relay never holds back the stored ones.
  const listeners = new Set<(event: ChatReactionEvent) => void>();
  const emit = (event: ChatReactionEvent) => {
    for (const listener of listeners) listener(event);
  };

  const readStored = async (): Promise<ChatReactionEvent[]> =>
    (await getConversationReactionRows(me, peer))
      .map(storedChatReactionEvent)
      .filter((e): e is ChatReactionEvent => !!e && isMember(e.pubkey));
  // Reads merge into what the thread already shows, so a store failure can
  // degrade to the public results instead of rejecting them too.
  const storedEvents = async (kind: number): Promise<ChatReactionEvent[]> =>
    (await readStored().catch(() => [])).filter((e) => e.kind === kind);

  // A failed or timed-out relay read must not hide the stored reactions.
  const publicRead = async <T extends { pubkey: string }>(read: () => Promise<T[]>) => {
    try {
      return (await read()).filter((e) => isMember(e.pubkey));
    } catch {
      return [];
    }
  };

  // Store our own reaction / retraction before sending it, so it survives a
  // restart even if the relay echo of our self-copy never arrives. The echo
  // replaces this `local-` row (same rumor id) when it does.
  const send = async (rumor: ChatRumor): Promise<string | null> => {
    const rumorId = directMessageRumorEventId(rumor);
    const localId = `${LOCAL_DM_ID_PREFIX}${rumorId}`;
    await upsertDmMessages([
      {
        owner: me,
        eventId: localId,
        conversation: peer,
        createdAt: rumor.created_at,
        sender: me,
        content: serializeChatReactionRumor(rumor),
        fromMe: true,
        wireKind: rumor.kind,
        rumorId,
      },
    ]);
    let sent = false;
    try {
      sent = await deps.sendRumor(rumor);
    } catch {
      sent = false;
    }
    if (!sent) {
      await deleteLocalDmRow(me, localId).catch(() => undefined);
      return null;
    }
    return rumorId;
  };

  return {
    fetchReactionsForMessages: async (ids) => {
      if (ids.length === 0) return [];
      const wanted = new Set(ids.map((id) => id.toLowerCase()));
      // NIP-25: the target is the last `e` tag.
      const targets = (e: ChatReactionEvent) => {
        const ids = eTagTargets(e);
        return ids.length > 0 && wanted.has(ids[ids.length - 1]);
      };
      // Older public reactions (and their retractions) follow on the live
      // channel once the relays answer.
      void publicRead(() => deps.publicReactions.fetchReactionsForMessages(ids)).then(
        async (reactions) => {
          if (reactions.length === 0) return;
          for (const e of reactions) publicIds.add(e.id.toLowerCase());
          const retractions = await publicRead(() =>
            deps.publicReactions.fetchReactionDeletions(reactions.map((e) => e.id)),
          );
          for (const e of reactions) emit(e);
          for (const e of retractions) emit({ ...e, kind: CHAT_DELETION_KIND, content: '' });
        },
      );
      return (await storedEvents(CHAT_REACTION_KIND)).filter(targets);
    },
    fetchReactionDeletions: async (ids) => {
      if (ids.length === 0) return [];
      const wanted = new Set(ids.map((id) => id.toLowerCase()));
      return (await storedEvents(CHAT_DELETION_KIND)).filter((e) =>
        eTagTargets(e).some((t) => wanted.has(t)),
      );
    },
    publishReaction: (input) =>
      send(buildChatReactionRumor({ myPubkey: me, peerPubkey: peer, ...input })).catch(() => null),
    deleteReaction: async (reactionEventId) => {
      const id = reactionEventId.toLowerCase();
      const wrapped = await send(
        buildChatReactionDeletionRumor({ myPubkey: me, peerPubkey: peer, reactionEventId: id }),
      ).catch(() => null);
      if (!publicIds.has(id)) return wrapped !== null;
      // An older public reaction: ask relays to delete it too.
      const removed = await deps.publicReactions.deleteReaction(id).catch(() => false);
      return removed || wrapped !== null;
    },
    subscribe: (onEvent) => {
      let active = true;
      const emitted = new Set<string>();
      const read = readStored;
      // Rows already stored are the fetch's job; only later commits are live.
      let chain = read()
        .then((events) => {
          for (const e of events) emitted.add(e.id);
        })
        .catch(() => undefined);
      listeners.add(onEvent);
      const unsubscribe = subscribeDmStorage((owner) => {
        if (owner !== me) return;
        chain = chain
          .then(async () => {
            if (!active) return;
            for (const e of await read()) {
              if (emitted.has(e.id)) continue;
              emitted.add(e.id);
              if (active) onEvent(e);
            }
          })
          .catch(() => undefined);
      });
      return () => {
        active = false;
        listeners.delete(onEvent);
        unsubscribe();
      };
    },
  };
}
