import React, { useCallback, useMemo } from 'react';
import { Alert } from '../components/BrandedAlert';
import { parsePoll, parseVote, buildVoteMessage } from '../utils/pollMessage';
import {
  POLL_KIND,
  VOTE_KIND,
  buildPollRumor,
  buildVoteRumor,
  legacyPollToStored,
  parseStoredPoll,
  parseStoredVote,
  serializePollFromRumor,
  serializeVoteFromRumor,
  tallyPoll,
  type PollTally,
  type StoredPoll,
  type VoteRecord,
} from '../utils/nip88Poll';
import type { ConversationMessageInput } from '../utils/conversationItems';
import type { SendResult, SendHooks } from '../contexts/useMessageSend';

interface UseConversationPollsParams {
  /** The 1:1 thread's messages (polls + votes ride here as normal DMs). */
  messages: ConversationMessageInput[];
  /** Local viewer's hex pubkey — used to light up the user's own selection. */
  myPubkey: string | null | undefined;
  /** The peer's hex pubkey — the send target for polls + votes. */
  pubkey: string;
  /** Legacy text send (back-compat voting on a text-encoded poll). */
  sendDirectMessage: (recipientPubkey: string, plaintext: string) => Promise<SendResult>;
  /** Structured send: gift-wrap a pre-built kind-1068/1018 rumor. */
  sendDirectRumor: (
    recipientPubkeys: string[],
    rumor: { kind: number; created_at: number; tags: string[][]; content: string; pubkey: string },
    hooks?: SendHooks,
  ) => Promise<SendResult>;
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessageInput[]>>;
}

interface UseConversationPollsResult {
  /** Per-poll tally keyed by the poll's correlation id. */
  pollAggregates: Map<string, PollTally>;
  /** Send a poll (question + options) as a structured kind-1068 gift-wrap. */
  handleSendPoll: (question: string, options: string[]) => Promise<boolean>;
  /** Cast a vote on a poll option — kind-1018 gift-wrap (structured polls) or a
   *  legacy text `[POLL_VOTE]` DM (legacy text polls). */
  handleVotePoll: (pollId: string, optionId: string) => Promise<void>;
}

/**
 * Poll aggregation + send/vote for a 1:1 DM thread (#203). Sends REAL NIP-88
 * events — a kind-1068 poll rumor / kind-1018 vote rumor — gift-wrapped to the
 * peer via the NIP-17 send path, and tallies them client-side from the
 * decrypted DM stream. A read-only fallback keeps rendering + tallying the old
 * text-encoded MVP format, so a thread that already carries a text poll (from
 * an earlier build of this unreleased branch) still works. Extracted from
 * ConversationScreen so the screen stays under the #703 size cap.
 */
export function useConversationPolls({
  messages,
  myPubkey,
  pubkey,
  sendDirectMessage,
  sendDirectRumor,
  setMessages,
}: UseConversationPollsParams): UseConversationPollsResult {
  // Collect polls + votes across the thread from BOTH wire formats:
  //   - structured: wireKind 1068 (poll JSON) / 1018 (vote JSON)
  //   - legacy text: a kind-14 `[POLL]` / `[POLL_VOTE]` body
  // then tally each poll. Recomputed when messages change (a new vote is a new
  // message) — cheap: a JSON.parse or regex per row plus small Map inserts.
  const { pollAggregates, structuredPollIds } = useMemo(() => {
    const polls: StoredPoll[] = [];
    const votes: VoteRecord[] = [];
    const structured = new Set<string>();
    const viewer = myPubkey ?? null;
    for (const m of messages) {
      if (m.wireKind === POLL_KIND) {
        const stored = parseStoredPoll(m.text);
        if (stored) {
          polls.push(stored);
          structured.add(stored.pollId);
        }
        continue;
      }
      if (m.wireKind === VOTE_KIND) {
        const vote = parseStoredVote(m.text);
        // An optimistic self-vote may land before myPubkey is known; the stored
        // vote already carries the real voter, so nothing to synthesise here.
        if (vote) votes.push(vote);
        continue;
      }
      // Legacy text-encoded poll / vote (read-only back-compat). 1:1 has no
      // per-message sender, so synthesise a per-direction voter id — enough for
      // last-write-wins between the two parties.
      const legacyPoll = parsePoll(m.text);
      if (legacyPoll) {
        polls.push(legacyPollToStored(`dm-${m.id}`, legacyPoll));
        continue;
      }
      const legacyVote = parseVote(m.text);
      if (legacyVote) {
        votes.push({
          pollId: legacyVote.pollId,
          voter: m.fromMe ? (myPubkey ?? '_me') : `peer:${pubkey}`,
          optionIds: [String(legacyVote.optionId)],
          createdAt: m.createdAt,
        });
      }
    }
    const out = new Map<string, PollTally>();
    for (const poll of polls) out.set(poll.pollId, tallyPoll(poll, votes, viewer));
    return { pollAggregates: out, structuredPollIds: structured };
  }, [messages, myPubkey, pubkey]);

  // Optimistically append a row so the bubble/tally reflect the send before the
  // relay echo lands. The row id stays `local-…` so the text+window dedup
  // collapses it against the echo (whose id is the outer wrap id); the stored
  // `text` is the SAME canonical JSON the echo will produce (the rumor is
  // deterministic), so the dedup matches and the tally never double-counts.
  const appendOptimistic = useCallback(
    (eventId: string, kind: number, text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${eventId}`,
          rumorId: eventId,
          fromMe: true,
          text,
          createdAt: Math.floor(Date.now() / 1000),
          wireKind: kind,
        },
      ]);
    },
    [setMessages],
  );

  const handleSendPoll = useCallback(
    async (question: string, options: string[]): Promise<boolean> => {
      if (!myPubkey) {
        Alert.alert('Send failed', 'Not logged in.');
        return false;
      }
      let rumor;
      try {
        rumor = buildPollRumor({
          senderPubkey: myPubkey,
          recipientPubkeys: [pubkey],
          question,
          options,
        });
      } catch (err) {
        Alert.alert('Could not send poll', err instanceof Error ? err.message : 'Invalid poll.');
        return false;
      }
      const stored = serializePollFromRumor(rumor);
      const result = await sendDirectRumor([pubkey], rumor, {
        onRumorReady: ({ eventId, kind }) => {
          if (stored) appendOptimistic(eventId, kind, stored);
        },
      });
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send poll.');
        return false;
      }
      return true;
    },
    [myPubkey, pubkey, sendDirectRumor, appendOptimistic],
  );

  const handleVotePoll = useCallback(
    async (pollId: string, optionId: string) => {
      // Legacy text poll → keep voting via the text `[POLL_VOTE]` path so an
      // already-rendered MVP poll stays interactive.
      if (!structuredPollIds.has(pollId)) {
        const optNum = Number(optionId);
        const payload = buildVoteMessage(pollId, Number.isFinite(optNum) ? optNum : 0);
        const result = await sendDirectMessage(pubkey, payload);
        if (!result.success) {
          Alert.alert('Vote failed', result.error ?? 'Could not record your vote.');
          return;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fromMe: true,
            text: payload,
            createdAt: Math.floor(Date.now() / 1000),
          },
        ]);
        return;
      }
      // Structured poll → cast a kind-1018 vote gift-wrapped back to the peer.
      // For multiplechoice the tap toggles the option within the current
      // selection; singlechoice replaces it. Either way the LATEST vote wins.
      if (!myPubkey) {
        Alert.alert('Vote failed', 'Not logged in.');
        return;
      }
      // Singlechoice: the tapped option replaces the selection. Multiplechoice:
      // the tap toggles it within the current selection. Either way the LATEST
      // vote (this one) wins in the tally.
      let optionIds: string[] = [optionId];
      if (pollTypeIsMulti(messages, pollId)) {
        const current = new Set(pollAggregates.get(pollId)?.myVotes ?? []);
        if (current.has(optionId)) current.delete(optionId);
        else current.add(optionId);
        // A vote with no responses isn't valid — treat "deselect the last one"
        // as re-selecting just this option rather than sending an empty vote.
        optionIds = current.size > 0 ? Array.from(current) : [optionId];
      }
      const rumor = buildVoteRumor({
        senderPubkey: myPubkey,
        recipientPubkeys: [pubkey],
        pollId,
        optionIds,
      });
      const stored = serializeVoteFromRumor(rumor);
      const result = await sendDirectRumor([pubkey], rumor, {
        onRumorReady: ({ eventId, kind }) => {
          if (stored) appendOptimistic(eventId, kind, stored);
        },
      });
      if (!result.success) {
        Alert.alert('Vote failed', result.error ?? 'Could not record your vote.');
      }
    },
    [
      structuredPollIds,
      myPubkey,
      pubkey,
      messages,
      pollAggregates,
      sendDirectMessage,
      sendDirectRumor,
      appendOptimistic,
      setMessages,
    ],
  );

  return { pollAggregates, handleSendPoll, handleVotePoll };
}

/** True when the structured poll identified by `pollId` is multiplechoice. */
function pollTypeIsMulti(messages: ConversationMessageInput[], pollId: string): boolean {
  for (const m of messages) {
    if (m.wireKind !== POLL_KIND) continue;
    const stored = parseStoredPoll(m.text);
    if (stored?.pollId === pollId) return stored.pollType === 'multiplechoice';
  }
  return false;
}
