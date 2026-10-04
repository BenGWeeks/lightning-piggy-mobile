import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createOnChainScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionGap: {
      marginTop: 28,
    },
    walletRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      marginBottom: 8,
    },
    walletRowActive: {
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPinkLight,
    },
    walletName: {
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '500',
      flex: 1,
      marginRight: 8,
    },
    emptyHint: {
      fontStyle: 'italic',
      marginTop: 4,
    },
  });
