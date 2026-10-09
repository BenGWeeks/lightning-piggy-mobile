import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createGroupMembersSheetStyles = (colors: Palette) =>
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
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    contentContainer: {
      paddingBottom: 60,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
    },
    doneText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.brandPink,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    rowName: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
    },
    youTag: {
      fontWeight: '400',
      color: colors.textSupplementary,
    },
    removeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.brandPinkLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 24,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      borderStyle: 'dashed',
    },
    addButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.brandPink,
    },
  });
