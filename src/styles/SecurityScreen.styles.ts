import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createSecurityScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    headerLabel: {
      marginBottom: 0,
    },
    sectionGap: {
      marginTop: 24,
    },
    optionList: {
      marginTop: 16,
      gap: 8,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    optionRowSelected: {
      // Selected radio row — brand pink + tint, matching the pink checkmark
      // and the active-row convention used in OnChainScreen.
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPinkLight,
    },
    optionTextBlock: {
      flex: 1,
      marginRight: 8,
    },
    optionLabel: {
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '600',
    },
    optionSublabel: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    customInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
    },
    customInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: 14,
      color: colors.textHeader,
      backgroundColor: colors.background,
    },
    customSatsLabel: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      marginTop: 8,
    },
  });

export type SecurityScreenStyles = ReturnType<typeof createSecurityScreenStyles>;
