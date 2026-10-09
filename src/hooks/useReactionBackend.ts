import { useMemo } from 'react';

import { marmotReactionSource } from '../services/marmotReactions';
import type { DmProtocol } from '../utils/dmProtocol';
import type { UseConversationReactionsParams } from './useConversationReactions';

type Backend = Pick<
  UseConversationReactionsParams,
  | 'fetchReactionsForMessages'
  | 'publishReaction'
  | 'deleteReaction'
  | 'fetchReactionDeletions'
  | 'subscribeLiveReactions'
>;

/**
 * Where a 1:1 thread's reactions live: a Marmot thread keeps them inside its
 * MLS group (White Noise's format, so they show up there too); NIP-17 / NIP-04
 * threads use public NIP-25 reactions on the relays (`relayBackend`).
 */
export function useReactionBackend(
  protocol: DmProtocol,
  myPubkey: string | null,
  peerPubkey: string,
  relayBackend: Omit<Backend, 'subscribeLiveReactions'>,
): Backend {
  const marmot = useMemo(
    () => (protocol === 'marmot' && myPubkey ? marmotReactionSource(myPubkey, peerPubkey) : null),
    [protocol, myPubkey, peerPubkey],
  );
  return useMemo(
    () =>
      marmot
        ? {
            fetchReactionsForMessages: marmot.fetchReactionsForMessages,
            fetchReactionDeletions: marmot.fetchReactionDeletions,
            publishReaction: marmot.publishReaction,
            deleteReaction: marmot.deleteReaction,
            subscribeLiveReactions: marmot.subscribe,
          }
        : relayBackend,
    [marmot, relayBackend],
  );
}
