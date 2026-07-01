import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link MarketProductCard}. Two layouts share these tokens:
 * - `variant="rail"` — a fixed-width vertical card for the Explore rail.
 * - `variant="list"` — a full-width card for the Market screen list.
 * Both lead with the product image so the card reads like the website's
 * product grid (image → title → price → seller).
 */
export const createMarketProductCardStyles = (colors: Palette) =>
  StyleSheet.create({
    // ----- rail (vertical, fixed width) ------------------------------------
    railCard: {
      width: 160,
      backgroundColor: colors.surface,
      borderRadius: 12,
      overflow: 'hidden',
    },
    // ----- list (full width) -----------------------------------------------
    listCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      overflow: 'hidden',
    },
    // ----- grid (square tile, fills a fixed-width wrapper) ------------------
    gridCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      overflow: 'hidden',
    },

    // ----- image (cover) ---------------------------------------------------
    imageWrap: {
      width: '100%',
      height: 130,
      backgroundColor: colors.background,
      position: 'relative',
    },
    // Square image for the grid tile — fills the tile width, height follows.
    gridImageWrap: {
      width: '100%',
      aspectRatio: 1,
      backgroundColor: colors.background,
      position: 'relative',
    },
    image: {
      width: '100%',
      height: '100%',
    },
    imageFallback: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPinkLight,
    },
    imageFallbackText: {
      fontSize: 32,
      fontWeight: '800',
      color: colors.brandPink,
    },

    // ----- body ------------------------------------------------------------
    body: {
      padding: 12,
      gap: 4,
    },
    // Condensed body for the grid tile (less padding, tighter gaps).
    gridBody: {
      padding: 10,
      gap: 3,
    },
    title: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    // Two-line title with a reserved min-height so tiles in a row stay a
    // uniform height whether the title wraps to one line or two.
    gridTitle: {
      fontSize: 13,
      lineHeight: 17,
      minHeight: 34,
    },
    priceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    price: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.brandPink,
    },
    // Seller line — optional merchant avatar followed by "from <shop>".
    sellerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 2,
    },
    seller: {
      flex: 1,
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    description: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
      marginTop: 2,
    },

    // ----- featured pill ---------------------------------------------------
    featuredBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.zapYellow,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 999,
    },
    featuredText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.zapYellowInk,
    },
  });

export type MarketProductCardStyles = ReturnType<typeof createMarketProductCardStyles>;
