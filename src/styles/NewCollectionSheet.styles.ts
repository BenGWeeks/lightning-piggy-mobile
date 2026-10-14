import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** The listing editor's "New collection" popup (#1534). */
export const createNewCollectionSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: { backgroundColor: colors.background },
    handle: { backgroundColor: colors.divider, width: 40 },
    container: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
    title: { fontSize: 18, fontWeight: '700', color: colors.textHeader },
    label: { fontSize: 14, fontWeight: '700', color: colors.textHeader },
    field: { gap: 6 },
    input: {
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textBody,
    },
    inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
    inputError: { borderColor: colors.red },
    error: { fontSize: 13, color: colors.red },
    save: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 48,
      borderRadius: 24,
      backgroundColor: colors.brandPink,
    },
    saveDisabled: { opacity: 0.5 },
    saveText: { fontSize: 16, fontWeight: '700', color: colors.white },
    cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    cancelText: { fontSize: 15, fontWeight: '700', color: colors.brandPink },
  });
