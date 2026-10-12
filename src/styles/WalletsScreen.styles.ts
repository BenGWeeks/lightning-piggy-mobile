import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createWalletsScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    walletSummary: {
      color: colors.white,
      fontSize: 14,
      opacity: 0.9,
    },
    walletRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    walletName: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
      flex: 1,
    },
    walletBalance: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '400',
      opacity: 0.8,
    },
    walletActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    addWalletButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 12,
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 2,
      // Secondary action — purple accent, consistent with the other outlined
      // secondary buttons (Edit Profile, Send Feedback).
      borderColor: colors.accentSecondary,
    },
    addWalletText: {
      color: colors.accentSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
