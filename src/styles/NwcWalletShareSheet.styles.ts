import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Presentation for the "Share Wallet" NWC picker sheet (sender side, #431). */
export const createNwcWalletShareSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    container: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 24,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 4,
      marginBottom: 12,
      textAlign: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    icon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: {
      flex: 1,
    },
    walletName: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    walletMeta: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    empty: {
      paddingVertical: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
  });

export type NwcWalletShareSheetStyles = ReturnType<typeof createNwcWalletShareSheetStyles>;
