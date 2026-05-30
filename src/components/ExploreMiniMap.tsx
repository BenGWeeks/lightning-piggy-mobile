import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { MapPin } from 'lucide-react-native';
import { LibreMiniMap } from './LibreMiniMap';
import { useThemeColors } from '../contexts/ThemeContext';
import { createExploreMiniMapStyles } from '../styles/ExploreMiniMap.styles';
import type { BtcMapPlace } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';

interface Props {
  locationDenied: boolean;
  lat: number | null;
  lon: number | null;
  userLat: number | null;
  userLon: number | null;
  userAccuracyMetres: number | null;
  merchants: BtcMapPlace[];
  caches: ParsedCache[];
  events: ParsedEvent[];
  onTapMap: () => void;
  onOpenLegend: () => void;
  onSelectMerchant: (m: BtcMapPlace) => void;
  onSelectCache: (c: ParsedCache) => void;
  onSelectEvent: (e: ParsedEvent) => void;
}

/**
 * Explore hub's preview mini-map, focus-gated (#778).
 *
 * MapLibre's native GL context + tile cache (~130–175 MB) persist for the
 * whole session once Explore is visited — `react-native-screens`'
 * `freezeOnBlur` releases the SurfaceView buffers but NOT the GL context, so
 * a second RenderThread leaks for the session. Gating the `LibreMiniMap`
 * render on `useIsFocused()` means the GL context is torn down whenever the
 * tab is frozen and only re-created on re-focus (the intended tradeoff: a
 * one-off re-init for a permanent memory win).
 *
 * While unfocused we render a lightweight placeholder occupying the same
 * layout slot (mirrors LibreMiniMap's own null-`lat` empty-View placeholder)
 * so the rail layout below doesn't jump on focus changes.
 */
export const ExploreMiniMap: React.FC<Props> = ({
  locationDenied,
  lat,
  lon,
  userLat,
  userLon,
  userAccuracyMetres,
  merchants,
  caches,
  events,
  onTapMap,
  onOpenLegend,
  onSelectMerchant,
  onSelectCache,
  onSelectEvent,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createExploreMiniMapStyles(colors), [colors]);
  const isFocused = useIsFocused();

  if (locationDenied) {
    return (
      <View style={styles.deniedCard}>
        <MapPin size={20} color={colors.brandPink} strokeWidth={2.5} />
        <View style={{ flex: 1 }}>
          <Text style={styles.deniedTitle}>Allow location for nearby content</Text>
          <Text style={styles.deniedSub}>
            We use a coarse 5 km area to find merchants, caches, and meetups around you. Nothing
            leaves your device beyond that.
          </Text>
        </View>
      </View>
    );
  }

  // Unfocused: don't mount MapLibre at all — render an empty layout-matching
  // placeholder so the GL context is released while the tab is frozen. Keep
  // the testID so flows still find the slot.
  if (!isFocused) {
    return <View style={styles.placeholder} testID="explore-minimap" />;
  }

  return (
    <LibreMiniMap
      // Mini-map is non-interactive (zoom-only, follows GPS) — so the camera
      // anchor SHOULD track the live position, not the stale one-shot `pos`
      // (seeded from a cached merchant-centroid anchor on cold start). Falls
      // back to `pos` only while the live fix is still resolving.
      lat={lat}
      lon={lon}
      userLat={userLat}
      userLon={userLon}
      userAccuracyMetres={userAccuracyMetres}
      merchants={merchants}
      caches={caches}
      events={events}
      onTapMap={onTapMap}
      onOpenLegend={onOpenLegend}
      // Pin-tap handlers — open the same MerchantDetailSheet / CacheDetailSheet
      // that MapScreen renders so the interaction shape is identical across
      // surfaces (PR #630). Events have no dedicated sheet in MapScreen either,
      // so the event tap navigates directly to EventDetail.
      onSelectMerchant={onSelectMerchant}
      onSelectCache={onSelectCache}
      onSelectEvent={onSelectEvent}
      // Maestro flow test-explore-tab-rename.yaml asserts this testID —
      // preserved across the MapLibre swap so the e2e smoke test isn't
      // repointed.
      testID="explore-minimap"
    />
  );
};

export default ExploreMiniMap;
