import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createExternalFundingSwapStyles = (colors: Palette) =>
  StyleSheet.create({
    history: { maxHeight: 180 },
    container: { gap: 12, paddingVertical: 12 },
    title: { color: colors.textHeader, fontSize: 18, fontWeight: '700' },
    text: { color: colors.textBody, fontSize: 14 },
    amount: { color: colors.textHeader, fontSize: 22, fontWeight: '700' },
    button: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
    },
    disabled: { opacity: 0.5 },
    qr: {
      alignItems: 'center',
      padding: 16,
      backgroundColor: '#ffffff',
      alignSelf: 'center',
      borderRadius: 12,
    },
  });
