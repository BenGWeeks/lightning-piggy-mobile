import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createAddFriendSheetStyles = (colors: Palette) =>
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
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 16,
    },
    toggleRow: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 3,
      marginBottom: 20,
    },
    toggleTab: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 8,
    },
    toggleTabActive: {
      backgroundColor: colors.white,
    },
    toggleText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    toggleTextActive: {
      color: colors.brandPink,
    },
    pasteContent: {
      width: '100%',
      gap: 16,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    input: {
      flex: 1,
      paddingVertical: 14,
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '500',
    },
    pasteButton: {
      padding: 8,
    },
    addButton: {
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    addButtonDisabled: {
      opacity: 0.5,
    },
    addButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    scanContent: {
      width: '100%',
      alignItems: 'center',
    },
    cameraContainer: {
      width: 250,
      height: 250,
      borderRadius: 16,
      overflow: 'hidden',
    },
    camera: {
      width: 250,
      height: 250,
    },
    scanLoading: {
      width: 250,
      height: 250,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 12,
    },
    scanLoadingText: {
      fontSize: 14,
      color: colors.textSupplementary,
    },
    scanErrorText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
      textAlign: 'center',
    },
    scanAgainButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
    },
    scanAgainText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });
