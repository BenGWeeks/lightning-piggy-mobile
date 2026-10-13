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
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: 50,
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
