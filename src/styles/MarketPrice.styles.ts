import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link MarketPrice}: the listing's own price (primary, brand
 * pink) with the "≈" conversion into the user's currency underneath (smaller,
 * muted). `detail` sizes match the product page; `compact` the grid/rail card.
 */
export const createMarketPriceStyles = (colors: Palette) =>
  StyleSheet.create({
    primaryRow: { flexDirection: 'row', alignItems: 'center' },
    detailPrimaryRow: { gap: 6 },
    compactPrimaryRow: { gap: 4, marginTop: 2 },
    detailPrimary: { fontSize: 18, fontWeight: '800', color: colors.brandPink },
    compactPrimary: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: colors.brandPink },
    detailConverted: { marginTop: 2, fontSize: 14, color: colors.textSupplementary },
    // One line reserved even while the rate loads (or for units we can't
    // convert) so tiles in the same grid row keep the same height.
    compactConvertedSlot: { height: 15 },
    compactConverted: { fontSize: 11, lineHeight: 15, color: colors.textSupplementary },
  });
