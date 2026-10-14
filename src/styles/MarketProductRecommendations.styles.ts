import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Width of one carousel card — the `rail` variant of MarketProductCard
 * (see `railCard` in MarketProductCard.styles.ts). */
export const RECO_CARD_WIDTH = 160;
/** Gap between carousel cards. */
export const RECO_CARD_GAP = 10;

export const createMarketProductRecommendationsStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      marginTop: 8,
    },
    section: {
      marginTop: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      marginBottom: 10,
      gap: 12,
    },
    title: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    seeAll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    seeAllText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.brandPink,
    },
    list: {
      paddingHorizontal: 16,
    },
    separator: {
      width: RECO_CARD_GAP,
    },
  });

export type MarketProductRecommendationsStyles = ReturnType<
  typeof createMarketProductRecommendationsStyles
>;
