import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createGroupHeaderTitleStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
    },
    title: {
      color: colors.white,
      fontSize: 22,
      fontWeight: '700',
      flexShrink: 1,
    },
  });
