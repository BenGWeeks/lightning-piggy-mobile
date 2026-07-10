import type { ViewStyle } from 'react-native';
import type { Palette } from './palettes';

// Single source of truth for the circular map-pin chassis shared by every
// map surface. Both LibreMiniMap (merchant / event / inline cache pins) and
// CacheMapMarker (the dedicated cache pin) spread this so the pins stay
// visually in lockstep by construction — a tweak to the shadow, border or
// 22 px diameter here updates both renderers at once instead of needing two
// edits that can silently drift apart.
//
// 22 px matches the Leaflet `lp-pin` size in the WebView spec so the swap is
// visually consistent across the two renderers.
export const createMapPinChassis = (colors: Palette): ViewStyle => ({
  width: 22,
  height: 22,
  borderRadius: 11,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1.5,
  borderColor: colors.white,
  shadowColor: '#000',
  shadowOpacity: 0.25,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
});
