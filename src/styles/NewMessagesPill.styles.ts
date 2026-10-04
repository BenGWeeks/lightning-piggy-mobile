import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createNewMessagesPillStyles = (colors: Palette) =>
  StyleSheet.create({
    lane: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
    button: {
      backgroundColor: colors.brandPink,
      borderRadius: 24,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderWidth: 2,
      borderColor: colors.white,
      elevation: 4,
    },
    text: { color: colors.white, fontWeight: '700' },
  });
