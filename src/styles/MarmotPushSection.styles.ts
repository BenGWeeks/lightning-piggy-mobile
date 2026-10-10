import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createMarmotPushSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 8,
    },
    statusText: {
      flex: 1,
      color: colors.white,
      fontSize: 13,
    },
    noticeText: {
      color: colors.white,
      fontSize: 13,
      marginTop: 8,
    },
    pillButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.white,
    },
    pillButtonText: {
      color: colors.brandPink,
      fontSize: 13,
      fontWeight: '700',
    },
    advancedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 14,
      paddingVertical: 4,
    },
    advancedToggleText: {
      flexShrink: 1,
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
    },
    advancedCard: {
      marginTop: 8,
      padding: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      gap: 8,
    },
    advancedText: {
      fontSize: 13,
      color: colors.textSupplementary,
    },
    serverInput: {
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      color: colors.textHeader,
      backgroundColor: colors.background,
    },
    advancedButtons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    primaryButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.brandPink,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
    secondaryButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    secondaryButtonText: {
      color: colors.brandPink,
      fontSize: 13,
      fontWeight: '700',
    },
  });

export type MarmotPushSectionStyles = ReturnType<typeof createMarmotPushSectionStyles>;
