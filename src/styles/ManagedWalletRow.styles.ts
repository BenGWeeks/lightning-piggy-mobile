import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createManagedWalletRowStyles = (_colors: Palette) =>
  StyleSheet.create({
    walletActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
      paddingHorizontal: 14,
      paddingBottom: 8,
    },
    action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  });
