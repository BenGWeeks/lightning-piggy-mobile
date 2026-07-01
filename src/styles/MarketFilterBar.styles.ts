import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketFilterBar} — the search input plus the merchant /
 * country / currency chip rows on the Market screen. Selected chips fill
 * brand-pink to
 * match {@link createMarketModeSelectorStyles}, so the filter controls read as
 * siblings of the marketplace-mode selector above them. */
export const createMarketFilterBarStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      paddingTop: 8,
      paddingBottom: 4,
      gap: 8,
      backgroundColor: colors.background,
    },
    // ----- search ----------------------------------------------------------
    searchRow: {
      marginHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      height: 40,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.textBody,
      // Strip the default vertical padding so the text centres in the pill.
      paddingVertical: 0,
    },
    // ----- chip rows -------------------------------------------------------
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    rowLabel: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      color: colors.textSupplementary,
      marginRight: 2,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    chipSelected: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textBody,
    },
    chipTextSelected: {
      color: colors.white,
      fontWeight: '700',
    },
    // ----- clear-all -------------------------------------------------------
    clearButton: {
      marginHorizontal: 16,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 2,
    },
    clearText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.brandPink,
    },
  });

export type MarketFilterBarStyles = ReturnType<typeof createMarketFilterBarStyles>;
