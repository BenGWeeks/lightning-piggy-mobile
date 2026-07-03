import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createSendNfcPaneStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      width: '100%',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 16,
    },
    instruction: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
      marginTop: 8,
    },
    description: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 19,
      paddingHorizontal: 24,
    },
    retryButton: {
      marginTop: 4,
      paddingHorizontal: 28,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    retryButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
  });
