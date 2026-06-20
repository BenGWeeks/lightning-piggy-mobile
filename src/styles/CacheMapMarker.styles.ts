import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
import { createMapPinChassis } from './mapPinChassis';

// Presentation for the shared cache map marker (CacheMapMarker) — the pin
// chassis shared by every map surface plus the top-right prize bolt badge.
// Styles live in their own file per the standing "styles live in their own
// file" convention (CLAUDE.md -> File size and modularity).
export const createCacheMapMarkerStyles = (colors: Palette) =>
  StyleSheet.create({
    // Wrapper so the absolutely-positioned prize bolt anchors to the pin.
    // It adds no size of its own — it just wraps the pin (whose size the
    // caller may override via markerDimStyle, e.g. MapScreen's
    // uniformMarkerSize) plus the overhanging bolt.
    wrap: {
      position: 'relative',
    },
    // Shared pin chassis — circular white-bordered chip carrying the
    // category Lucide glyph. Spreads the shared `createMapPinChassis` so the
    // marker stays byte-identical to LibreMiniMap's own pins by construction.
    pin: createMapPinChassis(colors),
    pinPiglet: { backgroundColor: colors.brandPink },
    pinCache: { backgroundColor: colors.cachePurple },
    // Yellow lightning prize badge, top-right of the pin. A small
    // white-ringed disc carrying a filled Zap glyph so it stays legible at
    // marker size over busy map tiles — mirrors LpPayoutBadge's look (the
    // list / card / My-Piglets prize indicator) so the maps and the lists
    // agree on what "has a prize" looks like.
    prizeBolt: {
      position: 'absolute',
      top: -5,
      right: -5,
      width: 16,
      height: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.white,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 1.5,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
  });

export type CacheMapMarkerStyles = ReturnType<typeof createCacheMapMarkerStyles>;
