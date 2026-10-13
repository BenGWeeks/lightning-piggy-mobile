import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createPollComposerSheetStyles = (colors: Palette) =>
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
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 18,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginTop: 8,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '500',
      marginBottom: 10,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    optionInput: {
      flex: 1,
    },
    removeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      marginBottom: 10,
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 4,
      alignSelf: 'flex-start',
      marginBottom: 16,
    },
    addButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
    maxedHint: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginBottom: 16,
      marginTop: 4,
    },
    sendButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
    },
    sendButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.5,
    },
  });
