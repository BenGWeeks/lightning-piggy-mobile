import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createDisplayScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 12,
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '500',
    },
    listCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    rowActive: {
      // Selected-row highlight — purple tint (matches the selected/active
      // state convention used across Settings).
      backgroundColor: colors.accentSecondaryLight,
    },
    symbolBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    symbolText: {
      color: colors.textBody,
      fontSize: 14,
      fontWeight: '700',
    },
    rowText: {
      flex: 1,
    },
    rowCode: {
      color: colors.textHeader,
      fontSize: 15,
      fontWeight: '700',
    },
    rowName: {
      color: colors.textSupplementary,
      fontSize: 13,
      marginTop: 2,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: 64,
    },
    empty: {
      padding: 24,
      alignItems: 'center',
    },
    emptyText: {
      color: colors.textSupplementary,
      fontSize: 14,
      textAlign: 'center',
    },
  });
