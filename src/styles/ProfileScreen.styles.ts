import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createProfileScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    qrCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, overflow: 'hidden' },
  });
