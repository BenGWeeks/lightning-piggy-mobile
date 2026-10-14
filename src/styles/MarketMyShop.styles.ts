import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** The My shop hub (#1534): one grouped card of settings rows on the
 * Market's light background. The settings kit's own card is translucent for
 * the gradient Account screens, so the hub draws a surface card instead. */
export const createMarketMyShopStyles = (colors: Palette) =>
  StyleSheet.create({
    groupCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    groupSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: 50,
    },
  });

export type MarketMyShopStyles = ReturnType<typeof createMarketMyShopStyles>;
