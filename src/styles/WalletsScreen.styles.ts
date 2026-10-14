import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createWalletsScreenStyles = (_colors: Palette) =>
  StyleSheet.create({
    caption: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 13,
      marginBottom: 8,
      marginLeft: 4,
    },
  });
