import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, InteractionManager } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { MapPin } from 'lucide-react-native';
import { LibreMiniMap } from './LibreMiniMap';
import { useThemeColors } from '../contexts/ThemeContext';
import { createExploreMiniMapStyles } from '../styles/ExploreMiniMap.styles';
import type { BtcMapPlace } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';

// How long MapLibre's GL context lingers after the Explore tab blurs before
// it's released (#810). Long enough to make quick tab bounces instant, short
// enough that leaving Explore for real still reclaims the ~130–175 MB promptly.
const GL_RELEASE_GRACE_MS = 15_000;

// Stable empty-array placeholders for the marker-stagger gate (#815). While
// markers are deferred we hand LibreMiniMap these instead of allocating a fresh
// `[]` each render. (Its `sameByItemRef` comparator already treats two empty
// arrays as equal by length, so this isn't about the memo — purely avoiding a
// per-render allocation while deferred.)
const NO_MERCHANTS: BtcMapPlace[] = [];
const NO_CACHES: ParsedCache[] = [];
const NO_EVENTS: ParsedEvent[] = [];

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
 * render on focus (with a short release grace, #810) tears the GL context down
 * once the tab stays blurred and re-creates it on focus — the intended tradeoff
 * of a re-init for a permanent memory win, minus the per-bounce thrash.
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

  // Deferred GL release (#810). The focus-gate below tears MapLibre's GL
  // context down on blur and re-creates it on focus — a permanent ~130–175 MB
  // memory win (#778) — but it makes EVERY Explore tab-switch pay MapLibre's
  // create/destroy in BOTH directions ("moving to/from Explore feels slow").
  // Keep the GL context alive for a short grace period after blur so quick tab
  // bounces (Explore → Home → Explore) reuse the live context and feel instant;
  // release it only if the tab stays blurred past the grace, reclaiming memory.
  const [glAlive, setGlAlive] = useState(isFocused);
  useEffect(() => {
    if (isFocused) {
      setGlAlive(true);
      return;
    }
    const t = setTimeout(() => setGlAlive(false), GL_RELEASE_GRACE_MS);
    return () => clearTimeout(t);
  }, [isFocused]);

  // Marker stagger (#815). On a FRESH GL context (first focus, or re-focus
  // after the grace released it) handing MapLibre ~160 merchant pins in the
  // same first commit as style + camera makes one ~1.4s GL block (39.75%
  // cold-tap jank, Stevie). Defer the marker set until the screen settles so
  // the map's first frame (style + camera) is cheap, then markers land in a
  // second, smaller reconciliation. Keyed on `glAlive` (not `isFocused`) so a
  // quick re-focus within the grace keeps the already-rendered markers — no
  // re-stagger, instant.
  const [markersReady, setMarkersReady] = useState(false);
  useEffect(() => {
    if (!glAlive) {
      setMarkersReady(false);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => setMarkersReady(true));
    return () => task.cancel();
  }, [glAlive]);

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

  // Released (blurred past the grace): don't mount MapLibre — render an empty
  // layout-matching placeholder so the GL context is freed. Keep the testID so
  // flows still find the slot. Within the grace window `glAlive` stays true, so
  // the live map is reused on a quick re-focus.
  if (!glAlive) {
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
      merchants={markersReady ? merchants : NO_MERCHANTS}
      caches={markersReady ? caches : NO_CACHES}
      events={markersReady ? events : NO_EVENTS}
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
