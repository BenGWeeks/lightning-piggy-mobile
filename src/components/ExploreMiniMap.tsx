import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { LibreMiniMap } from './LibreMiniMap';
import { useExploreMapState } from '../hooks/useExploreMapState';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useUserLocation } from '../contexts/UserLocationContext';
import { createExploreMiniMapStyles } from '../styles/ExploreMiniMap.styles';
import type { BtcMapPlace } from '../services/btcMapService';
import type { LiveUserLocation } from '../hooks/useLiveUserLocation';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';

const EMPTY_PINS = { merchants: [], caches: [], events: [] };

interface Props {
  locationDenied: boolean;
  /** One-shot anchor from the parent screen (cached merchant-centroid on
   *  cold start). The camera falls back to it only until the live GPS fix
   *  resolves — the live position is subscribed to HERE, not in the parent
   *  (see the perf note on the component). */
  fallbackAnchor: LiveUserLocation | null;
  merchants: BtcMapPlace[];
  caches: ParsedCache[];
  events: ParsedEvent[];
  onTapMap: () => void;
  onOpenLegend: () => void;
  onSelectMerchant: (m: BtcMapPlace) => void;
  onSelectCache: (c: ParsedCache) => void;
  onSelectEvent: (e: ParsedEvent) => void;
}

/** Explore map stays mounted across tab changes; live GPS only rerenders this view. */
export const ExploreMiniMap: React.FC<Props> = ({
  locationDenied,
  fallbackAnchor,
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
  const t = useTranslation();
  const styles = useMemo(() => createExploreMiniMapStyles(colors), [colors]);
  const { camera, mounted, pins, pinsReady, onMapReady, onCameraChange } = useExploreMapState({
    merchants,
    caches,
    events,
  });
  // Live position for the camera anchor + user dot. Mini-map is
  // non-interactive (zoom-only, follows GPS) so the camera SHOULD track the
  // live position, not the stale one-shot anchor — the anchor stands in only
  // while the live fix is still resolving. Cached-anchor accuracy is only
  // meaningful BEFORE a live fix arrives: once livePos exists, trust its
  // accuracy (even if null) so the halo never wraps live coords in stale data.
  const { pos: livePos } = useUserLocation();
  const lat = camera?.lat ?? livePos?.lat ?? fallbackAnchor?.lat ?? null;
  const lon = camera?.lon ?? livePos?.lon ?? fallbackAnchor?.lon ?? null;
  const userLat = livePos?.lat ?? null;
  const userLon = livePos?.lon ?? null;
  const userAccuracyMetres = livePos ? livePos.accuracy : (fallbackAnchor?.accuracy ?? null);

  if (locationDenied && lat === null) {
    return (
      <View style={styles.deniedCard}>
        <MapPin size={20} color={colors.brandPink} strokeWidth={2.5} />
        <View style={styles.deniedCopy}>
          <Text style={styles.deniedTitle}>{t('exploreMiniMap.allowLocationTitle')}</Text>
          <Text style={styles.deniedSub}>{t('exploreMiniMap.allowLocationBody')}</Text>
        </View>
      </View>
    );
  }

  if (!mounted) {
    return <View style={styles.placeholder} testID="explore-minimap" />;
  }

  const visiblePins = pinsReady ? pins : EMPTY_PINS;
  return (
    <LibreMiniMap
      defaultZoom={camera?.zoom ?? 13}
      onCameraChange={onCameraChange}
      onMapReady={onMapReady}
      lat={lat}
      lon={lon}
      userLat={userLat}
      userLon={userLon}
      userAccuracyMetres={userAccuracyMetres}
      merchants={visiblePins.merchants}
      caches={visiblePins.caches}
      events={visiblePins.events}
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
