import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createWebOfTrustChipStyles = (colors: Palette) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      // Yellow background distinguishes the safety chip from the pink
      // filter chips. zapYellow is the warmest yellow in the palette
      // (used for zap accents) — repurposed here as the WoT accent.
      backgroundColor: 'rgba(255, 193, 7, 0.18)',
      borderWidth: 1,
      borderColor: colors.zapYellow,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textHeader,
    },
  });
