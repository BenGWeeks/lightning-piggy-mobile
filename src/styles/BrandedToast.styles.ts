import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const sharedToastStyle = {
  height: undefined as number | undefined,
  minHeight: 60,
  paddingVertical: 10,
  borderRadius: 14,
  borderLeftWidth: 6,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.18,
  shadowRadius: 12,
  elevation: 6,
};

export const createBrandedToastStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderLeftWidth: 6,
      paddingVertical: 12,
      paddingHorizontal: 16,
      width: 340,
      minHeight: 60,
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 6,
    },
    text1: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    text2: {
      fontSize: 13,
      color: colors.textBody,
      marginTop: 2,
    },
  });
