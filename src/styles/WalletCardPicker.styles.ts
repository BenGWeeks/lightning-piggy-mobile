import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createWalletCardPickerStyles = (_colors: Palette) =>
  StyleSheet.create({
    // Grid variant — the original 2-up wrapping grid.
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    // Cover-flow variant.
    coverflow: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverflowItem: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginTop: 12,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: _colors.divider,
    },
    dotActive: {
      width: 16,
      backgroundColor: _colors.brandPink,
    },
    name: {
      marginTop: 10,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
      color: _colors.textHeader,
    },
  });

export type WalletCardPickerStyles = ReturnType<typeof createWalletCardPickerStyles>;
