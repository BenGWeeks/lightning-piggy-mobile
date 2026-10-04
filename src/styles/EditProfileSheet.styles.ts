import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createEditProfileSheetStyles = (colors: Palette) =>
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
    safetyTip: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 16,
      fontStyle: 'italic',
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginBottom: 6,
      marginTop: 12,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '500',
    },
    textArea: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    bannerPicker: {
      height: 100,
      borderRadius: 12,
      backgroundColor: colors.background,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
    },
    bannerPreview: {
      width: '100%',
      height: '100%',
    },
    avatarPicker: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.background,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'center',
    },
    avatarPreview: {
      width: 80,
      height: 80,
      borderRadius: 40,
    },
    avatarPlaceholder: {
      justifyContent: 'center',
      alignItems: 'center',
      gap: 2,
      width: 80,
      height: 80,
    },
    avatarPlaceholderText: {
      fontSize: 10,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    placeholderContent: {
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
    },
    placeholderText: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    saveButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 24,
    },
    saveButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.5,
    },
  });
