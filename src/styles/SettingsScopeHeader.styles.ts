import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createSettingsScopeHeaderStyles = (colors: Palette) =>
  StyleSheet.create({
    // The header owns the gap to the first section below it, so a screen
    // never needs its own top margin on the heading that follows.
    container: {
      marginBottom: 20,
    },
    header: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    hint: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: 13,
      marginTop: 2,
    },
    gap: {
      marginTop: 36,
    },
  });
