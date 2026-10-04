import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketProductDetailScreen} — header mirrors MarketScreen
 * so the Explore sub-screens read as siblings; the body is a scrolling product
 * page (image, info, buy, then the reviews/comments tabs). */
export const createMarketProductDetailStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 14,
      backgroundColor: colors.brandPink,
      minHeight: 96,
      overflow: 'hidden',
    },
    headerImage: { ...StyleSheet.absoluteFillObject },
    headerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(236, 0, 140, 0.65)',
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerSpacer: { width: 24 },

    scrollContent: { paddingBottom: 40 },

    // Product image. `aspectRatio: 1` is only the pre-load placeholder shape;
    // once the image loads, MarketProductDetailScreen overrides it inline with
    // the image's real aspect ratio so the hero isn't cropped to a square.
    imageWrap: {
      width: '100%',
      aspectRatio: 1,
      backgroundColor: colors.surface,
    },
    image: { width: '100%', height: '100%' },
    imageFallback: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPinkLight,
    },
    imageFallbackText: { fontSize: 64, fontWeight: '800', color: colors.brandPink },

    body: { padding: 16, gap: 12 },
    title: { fontSize: 22, fontWeight: '800', color: colors.textHeader },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    priceSats: { fontSize: 18, fontWeight: '800', color: colors.brandPink },
    priceFiat: { fontSize: 14, color: colors.textSupplementary },

    vendorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    vendorName: { fontSize: 14, fontWeight: '700', color: colors.textHeader },

    description: { fontSize: 15, color: colors.textBody, lineHeight: 22 },

    buyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      borderRadius: 999,
      paddingVertical: 14,
      marginTop: 4,
    },
    buyText: { color: colors.white, fontWeight: '800', fontSize: 15 },

    divider: {
      height: 1,
      backgroundColor: colors.divider,
      marginVertical: 16,
    },

    feedbackWrap: { paddingHorizontal: 16 },

    noFeedback: {
      marginHorizontal: 16,
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    noFeedbackText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 19,
    },

    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    missingText: { fontSize: 15, color: colors.textSupplementary, textAlign: 'center' },
  });
