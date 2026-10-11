import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketListingDetails} (stock, categories, shipping). */
export const createMarketListingDetailsStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { gap: 10, marginTop: 4, marginBottom: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    text: { fontSize: 14, color: colors.textBody, fontWeight: '600' },
    heading: { fontSize: 15, color: colors.textHeader, fontWeight: '700' },
    muted: { fontSize: 13, color: colors.textSupplementary },
    error: { fontSize: 13, color: colors.red },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: colors.brandPinkLight,
    },
    chipText: { fontSize: 12, fontWeight: '600', color: colors.brandPink },
    shipping: {
      gap: 8,
      padding: 12,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    quote: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    quoteBody: { flex: 1, gap: 2 },
    price: { fontSize: 14, fontWeight: '700', color: colors.brandPink },
  });
