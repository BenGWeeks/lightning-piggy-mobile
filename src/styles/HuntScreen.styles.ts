import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createHuntScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 14,
      backgroundColor: colors.brandPink,
      minHeight: 140,
      overflow: 'hidden',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerTagline: {
      marginTop: 10,
      paddingHorizontal: 4,
      color: 'rgba(255,255,255,0.85)',
      fontSize: 13,
      fontWeight: '500',
    },
    miniMapContainer: {
      // `listContent` carries NO horizontal padding (rows / headers own
      // their own marginHorizontal: 16). `LibreMiniMap` already applies
      // marginHorizontal: 16 internally, so no offset is needed here.
      // `listContent.paddingTop: 16` already gives the 16 dp header-to-map
      // gap shared across Explore / Places / Geo-caches. Bottom margin
      // gives breathing room before the community sections.
      marginBottom: 10,
    },
    // paddingTop: 16 — header-to-map gap, in sync with PlacesScreen's
    // `listContent` and ExploreHome's `scrollContent.paddingTop` so the
    // three Explore-stack screens share the same opening rhythm. No
    // paddingHorizontal — rows / search / headers each carry their own
    // marginHorizontal: 16 so adding it here would double-inset to 32 dp.
    scrollContent: { paddingTop: 16, paddingBottom: 32 },
    // Brand violet for NIP-GC caches — matches the new map pin (and
    // every other surface). Was textSupplementary (slate) which read
    // as "muted/disabled" and clashed with the now-coloured map pin.
  });
