import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createBrandedSpinnerStyles = (_colors: Palette) =>
  StyleSheet.create({
    small: { minWidth: 20, minHeight: 20 },
    large: { minWidth: 36, minHeight: 36 },
  });
