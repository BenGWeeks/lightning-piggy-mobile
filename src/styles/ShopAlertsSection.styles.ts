import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createShopAlertsSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    card: { borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
    subHeader: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 16,
      marginBottom: 8,
    },
    optionSublabel: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    chipRow: {
      paddingHorizontal: 14,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 100,
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    chipSelected: {
      backgroundColor: colors.surface,
    },
    chipText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 13,
    },
    chipTextSelected: {
      // Selected chip — purple accent (selected/active state convention).
      color: colors.accentSecondary,
    },
    flushTop: {
      marginTop: 0,
    },
    privacyHint: {
      paddingHorizontal: 14,
      marginBottom: 14,
      marginTop: 16,
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
      lineHeight: 18,
    },
  });
