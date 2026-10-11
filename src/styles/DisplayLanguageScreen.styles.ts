import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createDisplayLanguageScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionGap: {
      marginTop: 20,
    },
    // Matches the option rows below it (SettingsOptionList.styles.ts).
    currencyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.1)',
    },
    currencyText: {
      flex: 1,
    },
    currencyCode: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
    currencyName: {
      color: colors.white,
      fontSize: 12,
      opacity: 0.7,
      marginTop: 2,
    },
    changeText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
    },
  });
