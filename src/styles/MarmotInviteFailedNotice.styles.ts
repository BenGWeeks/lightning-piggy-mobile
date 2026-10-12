import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createMarmotInviteFailedNoticeStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      alignItems: 'center',
      paddingHorizontal: 24,
      marginVertical: 8,
    },
    card: {
      maxWidth: 340,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: 'dashed',
      borderColor: colors.divider,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
    },
    text: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    askButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    askText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.brandPink,
    },
    time: {
      fontSize: 11,
      color: colors.textSupplementary,
    },
  });

export type MarmotInviteFailedNoticeStyles = ReturnType<
  typeof createMarmotInviteFailedNoticeStyles
>;
