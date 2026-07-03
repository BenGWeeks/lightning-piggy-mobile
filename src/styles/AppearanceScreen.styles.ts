import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Radio-style option rows shared by the Theme and Sending animation sections
// on the Appearance screen. Extracted per the styles-in-their-own-file
// convention (CLAUDE.md → File size and modularity).
export const createAppearanceScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    optionList: {
      gap: 8,
    },
    section: {
      marginTop: 24,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    optionRowSelected: {
      borderColor: colors.white,
      backgroundColor: 'rgba(255,255,255,0.2)',
    },
    optionIcon: {
      width: 28,
      alignItems: 'center',
    },
    optionMain: {
      flex: 1,
    },
    optionLabel: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
    optionDescription: {
      color: colors.white,
      fontSize: 12,
      opacity: 0.7,
      marginTop: 2,
    },
  });

export type AppearanceScreenStyles = ReturnType<typeof createAppearanceScreenStyles>;
