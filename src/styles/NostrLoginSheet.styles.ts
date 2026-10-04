import { StyleSheet, Platform } from 'react-native';
import type { Palette } from './palettes';

export const createNostrLoginSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 8,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      marginBottom: 20,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 12,
    },
    input: {
      flex: 1,
      paddingVertical: 16,
      fontSize: 16,
      color: colors.textBody,
      fontWeight: '500',
    },
    pasteButton: {
      padding: 8,
    },
    error: {
      color: colors.red,
      fontSize: 13,
      marginTop: 8,
    },
    loginButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 16,
    },
    loginButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.5,
    },
    amberButton: {
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 12,
      borderWidth: 2,
      borderColor: colors.brandPink,
    },
    amberButtonText: {
      color: colors.brandPink,
      fontSize: 16,
      fontWeight: '700',
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 20,
      marginBottom: 12,
      gap: 12,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.divider,
    },
    dividerText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    createButton: {
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    createButtonText: {
      color: colors.textHeader,
      fontSize: 16,
      fontWeight: '700',
    },
    safetyTip: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 12,
      fontStyle: 'italic',
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginBottom: 6,
    },
    createInput: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 16,
      color: colors.textBody,
      fontWeight: '500',
    },
    backLink: {
      alignItems: 'center',
      marginTop: 16,
    },
    backLinkText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '600',
    },
    warningText: {
      fontSize: 14,
      color: colors.red,
      marginBottom: 20,
      lineHeight: 20,
    },
    nsecDisplay: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
    },
    nsecText: {
      fontSize: 13,
      color: colors.textBody,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      lineHeight: 18,
    },
    copyButton: {
      height: 44,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 12,
      borderWidth: 2,
      borderColor: colors.brandPink,
    },
    copyButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '600',
    },
    nip46QrContainer: {
      padding: 16,
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      alignSelf: 'center',
      marginTop: 8,
      marginBottom: 16,
    },
    nip46WaitingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      marginBottom: 12,
    },
    nip46WaitingText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
  });
