import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createAmberPermissionSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    banner: {
      padding: 12,
      marginHorizontal: 16,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    bannerText: { color: colors.brandPink, fontWeight: '600' },
    container: {
      marginTop: 24,
    },
    hint: {
      color: colors.brandPink,
    },
    button: {
      marginTop: 8,
    },
  });
