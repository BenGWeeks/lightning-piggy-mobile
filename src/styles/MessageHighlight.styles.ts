import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createMessageHighlightStyles = (colors: Palette) =>
  StyleSheet.create({
    highlighted: { backgroundColor: colors.brandPink + '30', borderRadius: 12 },
  });
