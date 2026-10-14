import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Currencies screen (#1534): a short intro, then one grouped card holding
 * the radio list. */
export const createMarketShopCurrenciesStyles = (colors: Palette) =>
  StyleSheet.create({
    body: { flex: 1, padding: 16, gap: 12 },
    intro: { gap: 4 },
    card: {
      flexShrink: 1,
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: 48,
    },
  });
