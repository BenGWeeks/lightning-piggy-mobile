import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createMessageActionsSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 24,
      gap: 16,
    },
    title: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    emojiRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 8,
    },
    moreEmojiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    // 44pt (the iOS/Android minimum touch target) so the six quick
    // reactions + the "more" button share one row on a typical phone.
    emojiButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      // Border keeps the button visually anchored against pink/blue
      // backgrounds; the active state swaps the border to brandPink so
      // "I've already reacted with this" reads at a glance.
      borderWidth: 2,
      borderColor: 'transparent',
    },
    emojiButtonActive: {
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPink + '22',
    },
    emojiText: {
      fontSize: 24,
    },
    zapButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.brandPink,
    },
    copyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    copyButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    zapButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.white,
    },
  });
