import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createFeedbackSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      padding: 20,
      paddingBottom: 40,
      gap: 12,
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
      textAlign: 'center',
    },
    textInput: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      fontSize: 14,
      color: colors.textBody,
      minHeight: 120,
      textAlignVertical: 'top',
    },
    charCount: {
      fontSize: 12,
      color: colors.textSupplementary,
      textAlign: 'right',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 4,
    },
    cancelButton: {
      flex: 1,
      height: 48,
      borderRadius: 12,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.divider,
    },
    cancelButtonText: {
      color: colors.textBody,
      fontSize: 14,
      fontWeight: '600',
    },
    sendButton: {
      flex: 1,
      height: 48,
      borderRadius: 12,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    sendButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '700',
    },
    loginPrompt: {
      alignItems: 'center',
      gap: 16,
      paddingVertical: 20,
    },
    loginText: {
      fontSize: 14,
      color: colors.textBody,
      textAlign: 'center',
    },
    loginButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
    },
    loginButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '700',
    },
  });
