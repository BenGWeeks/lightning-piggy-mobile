import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createDeviceNoticeLineStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 6,
    },
    text: {
      fontSize: 12,
      textAlign: 'center',
      color: colors.textSupplementary,
    },
  });
