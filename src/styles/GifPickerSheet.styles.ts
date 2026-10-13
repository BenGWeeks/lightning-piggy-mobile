import { StyleSheet, Platform } from 'react-native';
import type { Palette } from './palettes';
export const GRID_GAP = 8;

export const createGifPickerSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 8,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.background,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      color: colors.textBody,
      padding: 0,
    },
    grid: {
      paddingHorizontal: 20,
      paddingBottom: 40,
      gap: GRID_GAP,
    },
    row: {
      gap: GRID_GAP,
      marginBottom: GRID_GAP,
    },
    tile: {
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    tileImage: {
      width: '100%',
      height: '100%',
    },
    loading: {
      paddingVertical: 60,
      alignItems: 'center',
    },
    emptyState: {
      paddingHorizontal: 20,
      paddingVertical: 40,
      alignItems: 'center',
      gap: 8,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
    },
    code: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      color: colors.textBody,
    },
    emptyAction: {
      marginTop: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    emptyActionText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    attribution: {
      textAlign: 'center',
      fontSize: 11,
      color: colors.textSupplementary,
      paddingVertical: 12,
    },
  });
