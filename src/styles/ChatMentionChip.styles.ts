import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Same chip look as PR #1334's NostrContent mention (`mentionWrap` /
// `mentionChip` / `mentionText`), sized for chat bubbles, plus a variant for
// the pink sent bubble.
export const createChatMentionChipStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: {
      // Inline views sit on the text baseline; nudge to line up with the words.
      transform: [{ translateY: 4 }],
    },
    chip: {
      backgroundColor: colors.brandPinkLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${colors.brandPink}55`,
      borderRadius: 8,
      paddingHorizontal: 5,
      maxWidth: 220,
    },
    chipMe: {
      backgroundColor: 'rgba(0,0,0,0.08)',
      borderColor: colors.outgoingBubble.foreground,
    },
    text: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
      color: colors.brandPink,
    },
    textMe: {
      color: colors.outgoingBubble.foreground,
    },
  });

export type ChatMentionChipStyles = ReturnType<typeof createChatMentionChipStyles>;
