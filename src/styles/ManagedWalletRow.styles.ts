import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** One compact (~56 px) line per wallet on Manage wallets (#1544). */
export const createManagedWalletRowStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingLeft: 14,
      paddingRight: 6,
    },
    body: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    iconTile: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { flex: 1, minWidth: 0 },
    name: { color: colors.white, fontSize: 15, fontWeight: '600' },
    detail: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1 },
    status: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 6 },
    actions: { flexDirection: 'row', alignItems: 'center' },
    action: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  });

export type ManagedWalletRowStyles = ReturnType<typeof createManagedWalletRowStyles>;
