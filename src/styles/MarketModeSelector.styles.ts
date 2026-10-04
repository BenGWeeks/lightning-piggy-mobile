import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketModeSelector} — the horizontal chip row that
 * picks which sellers the Market section sources products from. Selected
 * chips fill brand-pink; disabled ("coming soon") chips are greyed with a
 * lock + "Soon" tag and read as non-interactive. */
export const createMarketModeSelectorStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    chipSelected: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    // Disabled "coming soon" chip — visibly greyed, dashed to read as
    // non-interactive, and below full opacity.
    chipDisabled: {
      backgroundColor: colors.background,
      borderColor: colors.divider,
      borderStyle: 'dashed',
      opacity: 0.55,
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
    chipTextDisabled: {
      color: colors.textSupplementary,
    },
    soonPill: {
      marginLeft: 2,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 999,
      backgroundColor: colors.zapYellowLight,
    },
    soonText: {
      fontSize: 9,
      fontWeight: '800',
      color: colors.zapYellowDark,
      textTransform: 'uppercase',
    },
  });

export type MarketModeSelectorStyles = ReturnType<typeof createMarketModeSelectorStyles>;
