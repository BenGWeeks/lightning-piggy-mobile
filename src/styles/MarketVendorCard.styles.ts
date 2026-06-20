import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link MarketVendorCard}. Two layouts share these tokens:
 * - `variant="rail"` — a fixed-width vertical card for the Explore rail.
 * - `variant="list"` — a full-width horizontal row for the Market screen.
 */
export const createMarketVendorCardStyles = (colors: Palette) =>
  StyleSheet.create({
    // ----- rail (vertical, fixed width) ------------------------------------
    railCard: {
      width: 200,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 6,
      position: 'relative',
    },
    railLogoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },

    // ----- list (horizontal row) -------------------------------------------
    listRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      position: 'relative',
    },
    listBody: {
      flex: 1,
      gap: 4,
    },

    // ----- shared ----------------------------------------------------------
    logoWrap: {
      width: 48,
      height: 48,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logo: {
      width: '100%',
      height: '100%',
    },
    // Fallback shown when there's no logo URL or the image fails to load —
    // a pink monogram tile, mirroring the website's VendorCard fallback.
    logoFallback: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brandPinkLight,
    },
    logoFallbackText: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.brandPink,
    },
    name: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    meta: {
      fontSize: 11,
      color: colors.textSupplementary,
      fontWeight: '600',
    },
    description: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
    // ⚡ Bitcoin-accepted affordance — every vendor in this directory takes
    // Bitcoin, so the badge is unconditional and reassures at a glance.
    btcRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    btcText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.brandPink,
    },
    shopTypeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    // Featured highlight — a soft yellow pill, matching the rail's
    // "Featured" treatment on PlaceCard so the surfaces read as siblings.
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

export type MarketVendorCardStyles = ReturnType<typeof createMarketVendorCardStyles>;
