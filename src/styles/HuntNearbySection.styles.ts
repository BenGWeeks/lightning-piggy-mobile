import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Values carried over verbatim from HuntScreen's inline styles when the
// Nearby section moved into its own component (search row, empty/loading
// states) — the section renders pixel-identical, just relocated.
export const createHuntNearbySectionStyles = (colors: Palette) =>
  StyleSheet.create({
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 10,
      backgroundColor: colors.surface,
      borderRadius: 100,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.textHeader,
      paddingVertical: 4,
    },
    filterIconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    filterIconBadge: {
      position: 'absolute',
      top: -2,
      right: -2,
      minWidth: 16,
      height: 16,
      paddingHorizontal: 4,
      borderRadius: 8,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterIconBadgeText: {
      color: colors.white,
      fontSize: 10,
      fontWeight: '800',
    },
    center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    subtle: { fontSize: 14, color: colors.textSupplementary, textAlign: 'center', lineHeight: 20 },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 6,
      textAlign: 'center',
    },
    emptySearchText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      padding: 24,
    },
    emptyBold: { fontWeight: '700', color: colors.brandPink },
  });

export type HuntNearbySectionStyles = ReturnType<typeof createHuntNearbySectionStyles>;
