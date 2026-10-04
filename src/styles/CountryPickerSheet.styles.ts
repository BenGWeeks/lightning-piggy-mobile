import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for the Market checkout's "Ship to" country picker (#948). */
export const createCountryPickerSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.background,
    },
    handle: {
      backgroundColor: colors.divider,
      width: 40,
    },
    container: {
      flex: 1,
      paddingHorizontal: 20,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 12,
    },
    searchInput: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textBody,
      marginBottom: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rowName: {
      fontSize: 15,
      color: colors.textBody,
      flexShrink: 1,
    },
    rowNameSelected: {
      color: colors.brandPink,
      fontWeight: '700',
    },
    rowCode: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginLeft: 12,
    },
    empty: {
      paddingVertical: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSupplementary,
    },
    listContent: {
      paddingBottom: 24,
    },
  });

export type CountryPickerSheetStyles = ReturnType<typeof createCountryPickerSheetStyles>;
