import { useCallback, useMemo } from 'react';
import { Alert } from '../components/BrandedAlert';
import type { GroupMessage } from '../services/groupMessagesStorageService';
import { buildPollMessage, buildVoteMessage, parsePoll, parseVote } from '../utils/pollMessage';
import {
  legacyPollToStored,
  tallyPoll,
  type PollTally,
  type StoredPoll,
  type VoteRecord,
} from '../utils/nip88Poll';

/**
 * Polls in a group chat — the group sibling of `useConversationPolls`
 * (extracted from GroupConversationScreen to keep it under the size cap).
 * `sendText` is the group composer's optimistic text send.
 */
export function useGroupPolls(
  messages: GroupMessage[],
  myPubkey: string | null | undefined,
  sendText: (text: string) => Promise<boolean>,
) {
  // Per-poll aggregates over the entire group history. Group messages carry a
  // real `senderPubkey` (unlike 1:1 where we synthesise a per-direction voter
  // id), so the tally gets accurate last-write-wins per member. Groups keep the
  // TEXT-encoded poll format (the group message store is text-only — no inner
  // wireKind/tags column), so structured NIP-88 is 1:1-only for now (#203);
  // legacy polls are adapted to the shared display/tally shape here.
  const pollAggregates = useMemo<Map<string, PollTally>>(() => {
    const polls: StoredPoll[] = [];
    const votes: VoteRecord[] = [];
    for (const m of messages) {
      const p = parsePoll(m.text);
      if (p) {
        polls.push(legacyPollToStored(m.id, p));
        continue;
      }
      const v = parseVote(m.text);
      if (v) {
        votes.push({
          pollId: v.pollId,
          voter: m.senderPubkey,
          optionIds: [String(v.optionId)],
          createdAt: m.createdAt,
        });
      }
    }
    const out = new Map<string, PollTally>();
    for (const poll of polls) out.set(poll.pollId, tallyPoll(poll, votes, myPubkey ?? null));
    return out;
  }, [messages, myPubkey]);

  // Poll attach handlers — the composer returns the validated question +
  // options; groups serialise them to the text body and hand off to sendText
  // (the same path the GIF / location / contact-share attachments use). Vote
  // sends use sendText too so the optimistic local-append behaviour matches.
  const handleSendPoll = useCallback(
    async (question: string, options: string[]): Promise<boolean> => {
      let body: string;
      try {
        body = buildPollMessage(question, options);
      } catch (err) {
        Alert.alert('Could not send poll', err instanceof Error ? err.message : 'Invalid poll.');
        return false;
      }
      return sendText(body);
    },
    [sendText],
  );

  const handleVotePoll = useCallback(
    async (pollId: string, optionId: string) => {
      const optNum = Number(optionId);
      const payload = buildVoteMessage(pollId, Number.isFinite(optNum) ? optNum : 0);
      const ok = await sendText(payload);
      if (!ok) {
        Alert.alert('Vote failed', 'Could not record your vote.');
      }
    },
    [sendText],
  );

  return { pollAggregates, handleSendPoll, handleVotePoll };
}
