import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useNostr } from '../contexts/NostrContext';
import { marmotReactionSource } from '../services/marmotReactions';
import { nip17ReactionSource, type ChatRumor } from '../services/nip17ReactionSource';
import { fetchOwnDmReactions } from '../services/nostrReactions';
import { DEFAULT_RELAYS } from '../services/nostrRelayDefaults';
import { enabledAppRelays } from '../services/appRelayPrefs';
import type { ChatReactionEvent } from '../utils/nip17Reactions';
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

const noOwnReactions = async (): Promise<ChatReactionEvent[]> => [];

/** Gift-wraps a rumor to the recipients (NostrContext's `sendDirectRumor`). */
export type SendChatRumor = (
  recipients: string[],
  rumor: ChatRumor,
  hooks: { protocol: DmProtocol },
) => Promise<{ success: boolean }>;

/**
 * Where a 1:1 thread's reactions live:
 *  - Marmot: inside its MLS group (White Noise's format, so they show up there too).
 *  - NIP-17: gift-wrapped kind-7 / kind-5 rumors, like the messages (#1319).
 *    Public reactions from older builds are still read.
 *  - NIP-04: public NIP-25 reactions on the relays (`relayBackend`). The
 *    kind-4 messages they target are public events already.
 */
export function useReactionBackend(
  protocol: DmProtocol,
  myPubkey: string | null,
  peerPubkey: string,
  relayBackend: Omit<Backend, 'subscribeLiveReactions'>,
  sendDirectRumor: SendChatRumor,
  /** Our own public DM reactions from earlier builds (NIP-17 threads only). */
  fetchOwnPublicDmReactions: () => Promise<ChatReactionEvent[]> = noOwnReactions,
): Backend {
  // Latest send / read functions without rebuilding the backend (and
  // re-subscribing) whenever their identity changes, e.g. on a relay-list update.
  const sendRef = useRef(sendDirectRumor);
  const ownRef = useRef(fetchOwnPublicDmReactions);
  useEffect(() => {
    sendRef.current = sendDirectRumor;
    ownRef.current = fetchOwnPublicDmReactions;
  }, [sendDirectRumor, fetchOwnPublicDmReactions]);
  return useMemo(() => {
    if (!myPubkey) return relayBackend;
    if (protocol === 'marmot') {
      const marmot = marmotReactionSource(myPubkey, peerPubkey);
      return {
        fetchReactionsForMessages: marmot.fetchReactionsForMessages,
        fetchReactionDeletions: marmot.fetchReactionDeletions,
        publishReaction: marmot.publishReaction,
        deleteReaction: marmot.deleteReaction,
        subscribeLiveReactions: marmot.subscribe,
      };
    }
    if (protocol === 'nip17') {
      const nip17 = nip17ReactionSource({
        myPubkey,
        peerPubkey,
        sendRumor: async (rumor) =>
          (await sendRef.current([peerPubkey], rumor, { protocol: 'nip17' })).success,
        publicReactions: {
          fetchOwnDmReactions: () => ownRef.current(),
          fetchReactionDeletions: relayBackend.fetchReactionDeletions,
          deleteReaction: relayBackend.deleteReaction,
        },
      });
      return {
        fetchReactionsForMessages: nip17.fetchReactionsForMessages,
        fetchReactionDeletions: nip17.fetchReactionDeletions,
        publishReaction: nip17.publishReaction,
        deleteReaction: nip17.deleteReaction,
        subscribeLiveReactions: nip17.subscribe,
      };
    }
    return relayBackend;
  }, [protocol, myPubkey, peerPubkey, relayBackend]);
}

/** A 1:1 thread's reaction backend, wired to the signed-in account. */
export function useThreadReactionBackend(
  protocol: DmProtocol,
  myPubkey: string | null,
  peerPubkey: string,
): Backend {
  const {
    publishReaction,
    deleteReaction,
    fetchReactionsForMessages,
    fetchReactionDeletionsForReactions,
    sendDirectRumor,
    relays,
  } = useNostr();
  const relayBackend = useMemo(
    () => ({
      fetchReactionsForMessages,
      publishReaction,
      deleteReaction,
      fetchReactionDeletions: fetchReactionDeletionsForReactions,
    }),
    [
      fetchReactionsForMessages,
      publishReaction,
      deleteReaction,
      fetchReactionDeletionsForReactions,
    ],
  );
  // Where earlier builds published our DM reactions: write relays + defaults.
  const fetchOwnPublic = useCallback(async () => {
    if (!myPubkey) return [];
    const publishRelays = [
      ...relays.filter((r) => r.write).map((r) => r.url),
      ...enabledAppRelays('default', DEFAULT_RELAYS),
    ];
    return fetchOwnDmReactions(myPubkey, [...new Set(publishRelays)]);
  }, [myPubkey, relays]);
  return useReactionBackend(
    protocol,
    myPubkey,
    peerPubkey,
    relayBackend,
    sendDirectRumor,
    fetchOwnPublic,
  );
}
