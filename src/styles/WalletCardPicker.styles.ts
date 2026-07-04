import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createWalletCardPickerStyles = (colors: Palette) =>
  StyleSheet.create({
    // Cover-flow — a flick-through carousel with the centre card enlarged and
    // neighbours fanned/peeking on each side.
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
      backgroundColor: colors.divider,
    },
    dotActive: {
      width: 16,
      backgroundColor: colors.brandPink,
    },
    name: {
      marginTop: 10,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
      color: colors.textHeader,
    },
  });

export type WalletCardPickerStyles = ReturnType<typeof createWalletCardPickerStyles>;
