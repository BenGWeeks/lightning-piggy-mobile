import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createBlossomServersSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    primaryBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      backgroundColor: colors.white,
    },
    primaryBadgeText: {
      color: colors.brandPink,
      fontSize: 11,
      fontWeight: '700',
    },
    makePrimary: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.6)',
    },
    makePrimaryText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '600',
    },
  });
