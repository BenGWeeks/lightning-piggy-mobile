import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createCreateCoinosWalletSheetStyles = (colors: Palette) =>
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
      padding: 24,
      paddingBottom: 40,
      gap: 16,
    },
    section: {
      gap: 16,
    },
    iconBubble: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textBody,
      lineHeight: 20,
      textAlign: 'center',
    },
    warningCard: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 16,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    warningTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    warningBody: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 18,
    },
    advancedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
    },
    advancedToggleText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    advancedBlock: {
      gap: 8,
    },
    advancedLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    advancedHint: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 16,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
    },
    errorText: {
      color: colors.red,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    primaryButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 4,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    cancelButton: {
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cancelButtonText: {
      color: colors.textBody,
      fontSize: 14,
      fontWeight: '600',
    },
    creatingBlock: {
      alignItems: 'center',
      gap: 16,
      padding: 32,
    },
    creatingTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    creatingHint: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 18,
      textAlign: 'center',
    },
  });
