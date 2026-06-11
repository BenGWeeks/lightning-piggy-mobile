import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createNfcScanIndicatorStyles = (colors: Palette) =>
  StyleSheet.create({
    circle: {
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ring: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
