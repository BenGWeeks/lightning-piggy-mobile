import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { BarChart3, Check } from 'lucide-react-native';
import { formatTime } from '../utils/messageContent';
import type { ParsedPoll, PollAggregate } from '../utils/pollMessage';
import type { MessageBubbleStyles } from '../styles/MessageBubble.styles';
import type { Palette } from '../styles/palettes';

interface PollBubbleProps {
  poll: ParsedPoll;
  /** Pre-computed tally for this poll (undefined on cold start → zero counts). */
  agg: PollAggregate | undefined;
  fromMe: boolean;
  /** Poll message id — the vote target and the pollAggregates key. */
  id: string;
  createdAt: number;
  onVotePoll?: (pollId: string, optionId: number) => void;
  testIdPrefix: string;
  styles: MessageBubbleStyles;
  colors: Palette;
  /** Sender name label (group incoming bubbles only); null otherwise. */
  senderLabel: React.ReactNode;
}

/**
 * The poll bubble variant (#203, text-encoded MVP). Extracted from MessageBubble
 * so that file stays under the #703 size cap — pure presentation over the parsed
 * poll + its aggregate tally. Each option row is a tappable vote button whose
 * background fill tracks the vote percentage.
 */
export function PollBubble({
  poll,
  agg,
  fromMe,
  id,
  createdAt,
  onVotePoll,
  testIdPrefix,
  styles,
  colors,
  senderLabel,
}: PollBubbleProps) {
  const total = agg?.totalVotes ?? 0;
  const myVote = agg?.myVote ?? null;
  // Disable voting until the relay echo confirms the poll id: optimistic ids contain "local" and rotate to the gift-wrap id on dedup, which would orphan a vote that baked in the local id.
  const pending = id.includes('local');
  return (
    <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={[styles.pollCard, fromMe ? styles.pollCardMe : styles.pollCardThem]}>
        {senderLabel}
        <View style={styles.pollHeaderRow}>
          <BarChart3
            size={14}
            color={fromMe ? 'rgba(255,255,255,0.85)' : colors.textSupplementary}
          />
          <Text style={[styles.pollLabel, fromMe && styles.pollLabelMe]}>Poll</Text>
        </View>
        <Text style={[styles.pollQuestion, fromMe && styles.pollQuestionMe]}>{poll.question}</Text>
        {poll.options.map((opt) => {
          // Per-option count + percentage. Falls back to the parsed poll
          // (zero counts) when the aggregate hasn't been computed yet,
          // so the bubble lays out fully on cold start instead of
          // jumping when votes load.
          const optAgg = agg?.options.find((o) => o.id === opt.id);
          const count = optAgg?.count ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const isMine = myVote === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              activeOpacity={0.85}
              style={[
                styles.pollOptionRow,
                fromMe && styles.pollOptionRowMe,
                isMine && (fromMe ? styles.pollOptionRowMineMe : styles.pollOptionRowMineThem),
              ]}
              onPress={() => onVotePoll?.(id, opt.id)}
              disabled={!onVotePoll || pending}
              accessibilityLabel={`${opt.text}, ${count} ${count === 1 ? 'vote' : 'votes'}${isMine ? ', your vote' : ''}`}
              accessibilityState={{ selected: isMine, disabled: !onVotePoll || pending }}
              testID={`${testIdPrefix}-poll-${id}-option-${opt.id}`}
            >
              {/* Background fill bar — width tracks the percentage so
                  even at total=0 the row collapses to a flat track.
                  Stays absolute-positioned so the option text sits in
                  its own layer regardless of percentage width. */}
              <View
                style={[
                  styles.pollOptionFill,
                  fromMe ? styles.pollOptionFillMe : styles.pollOptionFillThem,
                  { width: `${pct}%` },
                ]}
              />
              <View style={styles.pollOptionContent}>
                <Text
                  style={[styles.pollOptionText, fromMe && styles.pollOptionTextMe]}
                  numberOfLines={2}
                >
                  {opt.text}
                </Text>
                <View style={styles.pollOptionMeta}>
                  {isMine ? (
                    <Check
                      size={14}
                      color={fromMe ? colors.white : colors.brandPink}
                      strokeWidth={3}
                    />
                  ) : null}
                  <Text style={[styles.pollOptionCount, fromMe && styles.pollOptionCountMe]}>
                    {total > 0 ? `${pct}% · ${count}` : count}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
        <Text style={[styles.pollFooter, fromMe && styles.pollFooterMe]}>
          {total === 0 ? 'No votes yet' : `${total} ${total === 1 ? 'vote' : 'votes'}`}
        </Text>
        <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
          {formatTime(createdAt)}
        </Text>
      </View>
    </View>
  );
}

export default PollBubble;
