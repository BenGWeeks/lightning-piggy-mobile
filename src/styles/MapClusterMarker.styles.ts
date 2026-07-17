import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
import { createMapPinChassis } from './mapPinChassis';

// Presentation for the map cluster chips (MapClusterMarker; #1071
// geo-caches, #1073 BTC Map places) — the "N nearby pins" count bubble
// shown until the map is zoomed in far enough to separate the group.
// Reuses the shared pin chassis so the chip reads as kin to the
// individual pins, slightly enlarged so the count stays legible over
// busy tiles. Variant colours match the pins they group: caches pink,
// merchants Bitcoin-orange (the on-chain pin hue, `#F7931A`, shared
// with LibreMiniMap.styles' `pinOnchain`).
export const createMapClusterMarkerStyles = (colors: Palette) =>
  StyleSheet.create({
    chip: {
      ...createMapPinChassis(colors),
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    chipCache: { backgroundColor: colors.brandPink },
    chipMerchant: { backgroundColor: '#F7931A' },
    count: {
      color: colors.white,
      fontSize: 12,
      fontWeight: '700',
    },
  });

export type MapClusterMarkerStyles = ReturnType<typeof createMapClusterMarkerStyles>;
