import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createDecryptedImageStyles = (colors: Palette) =>
  StyleSheet.create({
    blocked: { color: colors.textSupplementary, fontSize: 12 },
    center: { alignItems: 'center', justifyContent: 'center' },
  });
