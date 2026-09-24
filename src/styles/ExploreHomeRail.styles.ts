import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles local to the Explore hub's rails / cards / hub-specific bits
 * (the rail card variants — PlaceCard / CacheCard / EventCard / LessonCard —
 * plus the scroll container). Extracted from ExploreHomeScreen.tsx per the
 * "styles always in their own file" convention; the screen composes these
 * with the screen-level `ExploreHomeScreen.styles.ts`.
 */
export const createExploreHomeRailStyles = (colors: Palette) =>
  StyleSheet.create({
    scrollContent: {
      // 16dp gap between the brand header and the mini-map — kept in
      // sync with PlacesScreen + HuntScreen so the three Explore-stack
      // screens have an identical header-to-map rhythm.
      paddingTop: 16,
      paddingBottom: 32,
    },
    card: {
      width: 160,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 4,
      // Position relative so the absolute Featured badge anchors to it.
      position: 'relative',
    },
    cardFeaturedBadge: {
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
    cardFeaturedText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textHeader,
    },
    cardIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    cardThumb: {
      width: '100%',
      height: 80,
      borderRadius: 8,
      marginBottom: 6,
      backgroundColor: colors.divider,
    },
    cardThumbPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Relative wrapper so the payout badge anchors to the thumb's corner.
    cardThumbWrap: { position: 'relative' },
    cardIconLightning: { backgroundColor: colors.brandPink },
    cardIconOnchain: { backgroundColor: '#F5A623' },
    cardIconStandard: { backgroundColor: '#7A5CFF' },
    cardIconEvent: { backgroundColor: '#5b3aff' },
    cardTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeader,
    },
    cardSub: {
      fontSize: 11,
      color: colors.textSupplementary,
      fontWeight: '600',
    },
    cardSubSmall: {
      fontSize: 11,
      color: colors.textSupplementary,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 19,
    },
  });

export type ExploreHomeRailStyles = ReturnType<typeof createExploreHomeRailStyles>;
