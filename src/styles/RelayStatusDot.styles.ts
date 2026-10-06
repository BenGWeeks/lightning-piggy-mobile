import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createRelayStatusDotStyles = (colors: Palette) =>
  StyleSheet.create({
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.white,
    },
  });
