import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createDecryptedImageStyles = (_colors: Palette) =>
  StyleSheet.create({
    center: { alignItems: 'center', justifyContent: 'center' },
  });
