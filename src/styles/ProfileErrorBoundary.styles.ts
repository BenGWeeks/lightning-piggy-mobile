import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createProfileErrorBoundaryStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { padding: 16, alignItems: 'center', backgroundColor: colors.background },
    text: { marginTop: 8, color: colors.textSupplementary },
  });
