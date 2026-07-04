import React, { useCallback, useMemo } from 'react';
import { Alert } from '../components/BrandedAlert';
import {
  aggregateVotes,
  buildVoteMessage,
  parsePoll,
  parseVote,
  type ParsedPoll,
  type PollAggregate,
  type PollVoteRecord,
} from '../utils/pollMessage';
import type { ConversationMessageInput } from '../utils/conversationItems';

type SendResult = { success: boolean; error?: string };

interface UseConversationPollsParams {
  /** The 1:1 thread's messages (polls + votes ride here as normal DMs). */
  messages: ConversationMessageInput[];
  /** Local viewer's hex pubkey — used to light up the user's own selection. */
  myPubkey: string | null | undefined;
  /** The peer's hex pubkey — the send target and the "peer voter" identity. */
  pubkey: string;
  sendDirectMessage: (recipientPubkey: string, plaintext: string) => Promise<SendResult>;
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessageInput[]>>;
}

interface UseConversationPollsResult {
  /** Per-poll tally keyed by the poll message's item id (`dm-…`). */
  pollAggregates: Map<string, PollAggregate>;
  /** Send a serialised poll body (from PollComposerSheet). Returns success so
   *  the sheet knows whether to dismiss. */
  handleSendPoll: (pollBody: string) => Promise<boolean>;
  /** Cast a vote on a poll option — posts a `[POLL_VOTE]` follow-up DM. */
  handleVotePoll: (pollId: string, optionId: number) => Promise<void>;
}

/**
 * Poll aggregation + send/vote for a 1:1 DM thread (#203, text-encoded MVP).
 * Extracted from ConversationScreen so the screen stays under the #703 size
 * cap — the screen just wires the returned handlers into MessageBubble and
 * PollComposerSheet. Group threads have their own aggregation (they carry a
 * real per-member `senderPubkey`), so this hook is 1:1-specific.
 */
export function useConversationPolls({
  messages,
  myPubkey,
  pubkey,
  sendDirectMessage,
  setMessages,
}: UseConversationPollsParams): UseConversationPollsResult {
  // Poll aggregates, keyed by poll-message id. Recomputed when the
  // messages array changes (votes are conversation messages too, so
  // every new vote triggers this) — cheap because each poll/vote is a
  // single regex check + a small Map insert. The viewer pubkey lets the
  // bubble light up the user's own selection on incoming polls.
  //
  // 1:1 wrinkle: the local user's optimistic-append uses a synthetic
  // `local-…` id rather than their actual hex pubkey. Two names so we
  // accept votes posted under either label as "mine" (otherwise voting
  // immediately after the page mounts wouldn't tick the row).
  const pollAggregates = useMemo<Map<string, PollAggregate>>(() => {
    const polls: { id: string; poll: ParsedPoll }[] = [];
    const votes: PollVoteRecord[] = [];
    for (const m of messages) {
      const p = parsePoll(m.text);
      if (p) {
        polls.push({ id: `dm-${m.id}`, poll: p });
        continue;
      }
      const v = parseVote(m.text);
      if (v) {
        // Vote messages can come from either party in a 1:1: outgoing
        // local optimistic appends (`fromMe=true`) carry the local
        // viewer's identity even before the rumor lands; incoming
        // appends are the peer's vote. We don't have per-message
        // pubkeys on this side, so we synthesise a stable string per
        // direction. That's enough for the aggregator to treat each
        // side as one voter (last-write-wins) — exactly the semantics
        // a 1:1 conversation needs.
        votes.push({
          pollId: v.pollId,
          voter: m.fromMe ? (myPubkey ?? '_me') : `peer:${pubkey}`,
          optionId: v.optionId,
          createdAt: m.createdAt,
        });
      }
    }
    return aggregateVotes(polls, votes, myPubkey ?? '_me');
  }, [messages, myPubkey, pubkey]);

  // Poll send: serialised body comes from PollComposerSheet's onSend.
  // Returns success so the sheet knows whether to dismiss; we mirror the
  // GIF/contact pattern for the optimistic local-append.
  const handleSendPoll = useCallback(
    async (pollBody: string): Promise<boolean> => {
      const result = await sendDirectMessage(pubkey, pollBody);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send poll.');
        return false;
      }
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          fromMe: true,
          text: pollBody,
          createdAt: Math.floor(Date.now() / 1000),
        },
      ]);
      return true;
    },
    [pubkey, sendDirectMessage, setMessages],
  );

  // Poll vote: tapping an option row sends a `[POLL_VOTE] <pollId> <optId>`
  // follow-up DM. The pollId is the bubble's id (`dm-…` for relay rumors,
  // `local-…` for optimistic outgoing) — same string the bubble lookups
  // pollAggregates by, so the renderer reflects the new tally as soon as
  // the optimistic-append lands.
  const handleVotePoll = useCallback(
    async (pollId: string, optionId: number) => {
      const payload = buildVoteMessage(pollId, optionId);
      const result = await sendDirectMessage(pubkey, payload);
      if (!result.success) {
        // Vote failure is rare and silent-Toast would feel insufficient
        // for "your vote didn't actually count". Use an Alert so the
        // user knows to retry.
        Alert.alert('Vote failed', result.error ?? 'Could not record your vote.');
        return;
      }
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          fromMe: true,
          text: payload,
          createdAt: Math.floor(Date.now() / 1000),
        },
      ]);
    },
    [pubkey, sendDirectMessage, setMessages],
  );

  return { pollAggregates, handleSendPoll, handleVotePoll };
}
