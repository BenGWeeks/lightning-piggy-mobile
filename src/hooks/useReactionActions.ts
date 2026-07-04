import { useCallback } from 'react';
import * as nostrService from '../services/nostrService';
import { fetchReactions, fetchReactionDeletions } from '../services/nostrReactions';
import { buildReactionEvent, buildReactionDeletionEvent } from '../utils/reactions';
import type { SignedEvent } from '../contexts/nostrContextTypes';

// Per-message reaction actions (#205), lifted out of NostrContext (file-size
// cap) into a composed hook: publish a NIP-25 kind-7, retract it via NIP-09
// kind-5, and fetch reactions for a set of message ids. NostrContext owns the
// signer + relay state and just wires them in, then spreads the result into
// its context value.

interface RelayConfig {
  url: string;
  write: boolean;
}

export interface UseReactionActionsParams {
  pubkey: string | null;
  isLoggedIn: boolean;
  signEvent: (event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<SignedEvent | null>;
  relays: RelayConfig[];
  getReadRelays: () => string[];
}

export interface UseReactionActionsResult {
  publishReaction: (input: {
    emoji: string;
    targetEventId: string;
    targetAuthorPubkey: string;
    targetEventKind?: number;
  }) => Promise<string | null>;
  deleteReaction: (reactionEventId: string) => Promise<boolean>;
  fetchReactionsForMessages: (targetEventIds: string[]) => Promise<
    {
      id: string;
      pubkey: string;
      kind: number;
      content: string;
      created_at: number;
      tags: string[][];
    }[]
  >;
  fetchReactionDeletionsForReactions: (reactionEventIds: string[]) => Promise<
    {
      id: string;
      pubkey: string;
      created_at: number;
      tags: string[][];
    }[]
  >;
}

export function useReactionActions({
  pubkey,
  isLoggedIn,
  signEvent,
  relays,
  getReadRelays,
}: UseReactionActionsParams): UseReactionActionsResult {
  // Publish target for short reaction / deletion events: the union of the
  // user's own write relays + the defaults so foreign clients (Damus,
  // Amethyst, …) on disjoint relay sets still see the reaction. DMs
  // themselves use the same union, so reactions land on the same relay
  // surface as the message they target.
  const getReactionPublishRelays = useCallback((): string[] => {
    const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
    return [...new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS])];
  }, [relays]);

  const publishReaction = useCallback(
    async (input: {
      emoji: string;
      targetEventId: string;
      targetAuthorPubkey: string;
      targetEventKind?: number;
    }): Promise<string | null> => {
      if (!pubkey || !isLoggedIn) return null;
      const unsigned = buildReactionEvent(
        input.emoji,
        input.targetEventId,
        input.targetAuthorPubkey,
        input.targetEventKind,
      );
      const signed = await signEvent(unsigned);
      if (!signed) return null;
      try {
        await nostrService.publishSignedEvent(signed, getReactionPublishRelays());
        return signed.id;
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] publishReaction failed:', error);
        return null;
      }
    },
    [pubkey, isLoggedIn, signEvent, getReactionPublishRelays],
  );

  const deleteReaction = useCallback(
    async (reactionEventId: string): Promise<boolean> => {
      if (!pubkey || !isLoggedIn) return false;
      const unsigned = buildReactionDeletionEvent(reactionEventId);
      const signed = await signEvent(unsigned);
      if (!signed) return false;
      try {
        await nostrService.publishSignedEvent(signed, getReactionPublishRelays());
        return true;
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] deleteReaction failed:', error);
        return false;
      }
    },
    [pubkey, isLoggedIn, signEvent, getReactionPublishRelays],
  );

  const fetchReactionsForMessages = useCallback(
    async (targetEventIds: string[]) => {
      if (targetEventIds.length === 0) return [];
      try {
        return await fetchReactions(targetEventIds, getReadRelays());
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] fetchReactionsForMessages failed:', error);
        return [];
      }
    },
    [getReadRelays],
  );

  const fetchReactionDeletionsForReactions = useCallback(
    async (reactionEventIds: string[]) => {
      if (reactionEventIds.length === 0) return [];
      try {
        return await fetchReactionDeletions(reactionEventIds, getReadRelays());
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] fetchReactionDeletionsForReactions failed:', error);
        return [];
      }
    },
    [getReadRelays],
  );

  return {
    publishReaction,
    deleteReaction,
    fetchReactionsForMessages,
    fetchReactionDeletionsForReactions,
  };
}
