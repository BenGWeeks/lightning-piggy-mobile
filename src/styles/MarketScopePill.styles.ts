import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketScopePill} — the active seller-scope pill just
 * under the Market search row, plus its one-line scope note. */
export const createMarketScopePillStyles = (colors: Palette) =>
  StyleSheet.create({
    scopeRow: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, alignItems: 'flex-start' },
    scopeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.brandPink,
      backgroundColor: colors.surface,
    },
    scopeChipText: { fontSize: 12, fontWeight: '600', color: colors.brandPink },
    // Experimental-scope caveat / FoF build progress, under the pill.
    scopeNote: { marginTop: 6, fontSize: 12, color: colors.textSupplementary },
  });
