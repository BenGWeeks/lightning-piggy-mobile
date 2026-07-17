import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
import { createMapPinChassis } from './mapPinChassis';

// Presentation for the cache cluster chip (CacheClusterMarker, #1071) —
// the "N nearby geo-caches" count bubble shown until the map is zoomed
// in far enough to separate the group. Reuses the shared pin chassis so
// the chip reads as kin to the individual cache pins, slightly enlarged
// so the count stays legible over busy tiles.
export const createCacheClusterMarkerStyles = (colors: Palette) =>
  StyleSheet.create({
    chip: {
      ...createMapPinChassis(colors),
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.brandPink,
    },
    count: {
      color: colors.white,
      fontSize: 12,
      fontWeight: '700',
    },
  });

export type CacheClusterMarkerStyles = ReturnType<typeof createCacheClusterMarkerStyles>;
