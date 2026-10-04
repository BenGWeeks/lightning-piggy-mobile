import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createServerConnectionTestStyles = (colors: Palette) =>
  StyleSheet.create({
    button: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
      marginTop: 12,
    },
    buttonText: { color: colors.brandPink, fontWeight: '700', fontSize: 14 },
    result: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      borderRadius: 12,
      padding: 12,
      marginTop: 8,
      backgroundColor: colors.surface,
    },
    success: { backgroundColor: colors.greenLight },
    error: { backgroundColor: colors.redLight },
    text: { color: colors.textBody, flex: 1, fontSize: 14 },
    successText: { color: colors.greenDark },
    errorText: { color: colors.red },
  });
