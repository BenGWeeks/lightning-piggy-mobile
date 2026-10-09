// Reactions in a Marmot 1:1 chat, the way White Noise does them: a kind-7
// event (`content` = the emoji, one `e` tag → the message id) and a kind-5
// with an `e` tag to retract it — sent INSIDE the MLS group rather than
// published to public relays. MLS delivers each event once, so a thread reads
// them back from the group's durable history (which includes our own).
//
// Exposes the same shape as the NIP-25 relay functions so the conversation's
// reactions hook can use either backend unchanged.

import type { MarmotRumor } from './marmotSession';
import { buildMarmotRumor } from './marmotSession';
import { requireMarmotSession } from './marmotSend';

const REACTION_KIND = 7;
const DELETION_KIND = 5;

export interface MarmotReactionSource {
  fetchReactionsForMessages: (targetEventIds: string[]) => Promise<MarmotRumor[]>;
  fetchReactionDeletions: (reactionEventIds: string[]) => Promise<MarmotRumor[]>;
  publishReaction: (input: { emoji: string; targetEventId: string }) => Promise<string | null>;
  deleteReaction: (reactionEventId: string) => Promise<boolean>;
  /** Reactions / retractions arriving live in this chat. Returns unsubscribe. */
  subscribe: (onEvent: (rumor: MarmotRumor) => void) => () => void;
}

/** The reaction backend for `myPubkey`'s Marmot DM with `peer`. */
export function marmotReactionSource(myPubkey: string, peer: string): MarmotReactionSource {
  const dm = () => {
    const session = requireMarmotSession(myPubkey);
    const group = session.findDm(peer);
    if (!group) throw new Error('No Marmot chat with this person yet');
    return { session, group };
  };
  const query = async (kind: number, ids: string[]) => {
    if (ids.length === 0) return [];
    try {
      const { session, group } = dm();
      return await session.queryHistory(group.id, { kinds: [kind], '#e': ids });
    } catch {
      return [];
    }
  };
  const send = async (kind: number, content: string, targetId: string) => {
    const { session, group } = dm();
    const rumor = buildMarmotRumor(myPubkey, { kind, content, tags: [['e', targetId]] });
    const byRelay = await session.sendRumor(group.id, rumor);
    return Object.values(byRelay).some(Boolean) ? rumor.id : null;
  };
  return {
    fetchReactionsForMessages: (ids) => query(REACTION_KIND, ids),
    fetchReactionDeletions: (ids) => query(DELETION_KIND, ids),
    publishReaction: ({ emoji, targetEventId }) =>
      send(REACTION_KIND, emoji, targetEventId).catch(() => null),
    deleteReaction: async (reactionEventId) =>
      (await send(DELETION_KIND, '', reactionEventId).catch(() => null)) !== null,
    subscribe: (onEvent) => {
      let session;
      try {
        session = requireMarmotSession(myPubkey);
      } catch {
        return () => undefined;
      }
      return session.subscribe({
        onMessage: ({ group, rumor }) => {
          if (rumor.kind !== REACTION_KIND && rumor.kind !== DELETION_KIND) return;
          if (group.id === session.findDm(peer)?.id) onEvent(rumor);
        },
      });
    },
  };
}
