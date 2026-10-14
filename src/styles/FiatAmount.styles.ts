import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createFiatAmountStyles = (colors: Palette) =>
  StyleSheet.create({
    amount: { fontSize: 12, color: colors.textSupplementary },
  });
