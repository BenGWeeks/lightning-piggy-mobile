import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createAddWalletWizardStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handle: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      flex: 1,
      padding: 24,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 16,
    },
    stepContent: {
      gap: 16,
    },
    description: {
      fontSize: 14,
      color: colors.textBody,
      lineHeight: 20,
    },
    // --- Wallet type selection ---
    typeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 16,
      padding: 20,
      gap: 16,
    },
    typeCardIconWrapper: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    // CoinOS logo mark (rings + half-fill) on transparent background.
    // `tintColor` recolours every non-transparent pixel so the rings
    // pick up brand pink, matching the other tile icons.
    coinosLogo: {
      width: 32,
      height: 32,
      tintColor: colors.brandPink,
    },
    typeCardText: {
      flex: 1,
      gap: 4,
    },
    typeCardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    typeCardDesc: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 18,
    },
    // --- Inputs ---
    nwcInput: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 16,
      fontSize: 14,
      color: colors.textBody,
      minHeight: 80,
      textAlignVertical: 'top',
    },
    aliasInput: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 16,
      fontSize: 16,
      color: colors.textBody,
    },
    scannerContainer: {
      alignItems: 'center',
      gap: 12,
    },
    scanner: {
      width: 260,
      height: 260,
      borderRadius: 16,
      overflow: 'hidden',
    },
    secondaryButton: {
      backgroundColor: colors.background,
      height: 48,
      borderRadius: 12,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    secondaryButtonRow: {
      flexDirection: 'row',
      gap: 8,
    },
    secondaryButtonHalf: {
      flex: 1,
    },
    secondaryButtonText: {
      color: colors.textBody,
      fontSize: 16,
      fontWeight: '600',
    },
    primaryButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
    },
    backButton: {
      height: 52,
      paddingHorizontal: 20,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    backButtonText: {
      color: colors.textBody,
      fontSize: 16,
      fontWeight: '600',
    },
    errorText: {
      color: colors.red,
      fontSize: 14,
      fontWeight: '600',
    },
  });
