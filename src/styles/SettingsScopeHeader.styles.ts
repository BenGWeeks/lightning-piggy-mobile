import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createSettingsScopeHeaderStyles = (colors: Palette) =>
  StyleSheet.create({
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
