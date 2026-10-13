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
    labelRow: { flexDirection: 'row', alignItems: 'center' },
    info: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    gap: {
      marginTop: 36,
    },
  });
