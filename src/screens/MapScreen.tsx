import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import { ChevronLeft, MapPin, Navigation as NavigationIcon, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import {
  Bbox,
  BtcMapPlace,
  acceptsLightning,
  acceptsOnchain,
  daysSinceVerified,
  fetchPlacesInBbox,
  formatAddress,
  lightningAddressOf,
} from '../services/btcMapService';
import type { ParsedCache } from '../services/nostrPlacesService';
import { subscribeNearbyCaches } from '../services/nostrPlacesPublisher';
import { encodeGeohash, geohashPrefixes } from '../utils/geohash';

interface Props {
  navigation: ExploreNavigation;
}

type PermissionState = 'unknown' | 'granted' | 'denied';

interface BridgeMessage {
  type: 'ready' | 'bounds' | 'markerTap' | 'cacheTap';
  bbox?: Bbox;
  id?: number;
  /** Cache coord (`<kind>:<pubkey>:<d>`) for cacheTap messages. */
  coord?: string;
}

/**
 * Map sub-screen — discovers Bitcoin-accepting merchants near the user via
 * the BTC Map API (OSM-backed). Closes the foreground-browse part of #467;
 * the background-geofence + notifications part lands in milestone 3.
 *
 * Renderer is Leaflet on OpenStreetMap tiles via WebView (no Google Maps,
 * no API key, OSM-aligned with the underlying merchant data — see project
 * memory `BTC Map runs the commons (Nathan)`).
 */
const MapScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const webviewRef = useRef<WebView>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBbox = useRef<Bbox | null>(null);

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [places, setPlaces] = useState<BtcMapPlace[]>([]);
  const [caches, setCaches] = useState<Map<string, ParsedCache>>(new Map());
  const [selected, setSelected] = useState<BtcMapPlace | null>(null);
  const cachesCloserRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);

  // ------- permissions + initial position --------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const initBbox = bboxAround(pos.coords.latitude, pos.coords.longitude, 0.02);
        lastBbox.current = initBbox;
        await refreshPlaces(initBbox);
        setViewportInWebView(pos.coords.latitude, pos.coords.longitude, 14);

        // Subscribe to NIP-GC kind 37516 caches in the user's coarse
        // geohash neighbourhood. Renders Lightning Piggies (com.lightningpiggy.app
        // label) AND standard NIP-GC caches (treasures.to /
        // TapTheSatsMap / etc.) as a different pin glyph alongside
        // BTC Map merchants. See project memory `treasures.to interop`.
        const myGeohash = encodeGeohash(pos.coords.latitude, pos.coords.longitude, 7);
        const prefixes = geohashPrefixes(myGeohash, 5).filter((p) => p.length === 5);
        cachesCloserRef.current?.();
        cachesCloserRef.current = subscribeNearbyCaches(prefixes, (cache) => {
          setCaches((prev) => {
            const existing = prev.get(cache.coord);
            if (existing && existing.createdAt >= cache.createdAt) return prev;
            const next = new Map(prev);
            next.set(cache.coord, cache);
            return next;
          });
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      cachesCloserRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- WebView communication ----------------------------------------

  const setViewportInWebView = useCallback((lat: number, lng: number, zoom: number) => {
    if (!webviewRef.current) return;
    const js = `window.LP_setViewport && window.LP_setViewport(${lat}, ${lng}, ${zoom}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, []);

  const sendMarkers = useCallback((list: BtcMapPlace[]) => {
    if (!webviewRef.current) return;
    const payload = list.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lon,
      lightning: acceptsLightning(p),
    }));
    const js = `window.LP_setMarkers && window.LP_setMarkers(${JSON.stringify(payload)}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, []);

  const sendCaches = useCallback((list: ParsedCache[]) => {
    if (!webviewRef.current) return;
    const payload = list
      .filter((c) => c.geohash) // skip caches with no location
      .map((c) => ({
        coord: c.coord,
        // Decode the longest geohash back to lat/lon — quick and
        // dirty by inverse-bisection inline; for now we'll request
        // each cache's lat/lon to come pre-decoded from a separate
        // helper. The simplest path: caches with multi-precision g
        // tags from precision 9 give us ~5 m resolution which is
        // plenty for a pin. We use the longest tag's geohash decoded
        // via a tiny inverse-encode (TODO: extract).
        ...decodeGeohash(c.geohash as string),
        kind: c.isLpPiggy ? 'piggy' : 'cache',
      }));
    const js = `window.LP_setCaches && window.LP_setCaches(${JSON.stringify(payload)}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, []);

  // Re-emit markers any time `places` changes after the bridge is ready.
  useEffect(() => {
    if (webviewReady) sendMarkers(places);
  }, [places, webviewReady, sendMarkers]);

  useEffect(() => {
    if (webviewReady) sendCaches([...caches.values()]);
  }, [caches, webviewReady, sendCaches]);

  const refreshPlaces = useCallback(async (bbox: Bbox) => {
    try {
      const list = await fetchPlacesInBbox(bbox);
      setPlaces(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        setWebviewReady(true);
      } else if (msg.type === 'bounds' && msg.bbox) {
        const next = msg.bbox;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          lastBbox.current = next;
          refreshPlaces(next);
        }, 500);
      } else if (msg.type === 'markerTap' && typeof msg.id === 'number') {
        const hit = places.find((p) => p.id === msg.id);
        if (hit) setSelected(hit);
      } else if (msg.type === 'cacheTap' && typeof msg.coord === 'string') {
        navigation.navigate('HuntPiggyDetail', { coord: msg.coord });
      }
    },
    [places, refreshPlaces, navigation],
  );

  const recenterOnUser = useCallback(async () => {
    if (permission !== 'granted') return;
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setViewportInWebView(pos.coords.latitude, pos.coords.longitude, 15);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [permission, setViewportInWebView]);

  // ------- render --------------------------------------------------------

  if (permission === 'denied') {
    return (
      <View style={styles.container} testID="map-screen">
        <Header onBack={() => navigation.goBack()} colors={colors} />
        <View style={styles.deniedBody}>
          <MapPin size={64} color={colors.textSupplementary} strokeWidth={1.5} />
          <Text style={styles.deniedTitle}>Location permission required</Text>
          <Text style={styles.deniedSubtitle}>
            We use your location to show nearby Bitcoin merchants. Grant location access in Settings
            to enable this map.
          </Text>
          <TouchableOpacity
            style={styles.deniedButton}
            onPress={() => navigation.goBack()}
            testID="map-permission-back-button"
          >
            <Text style={styles.deniedButtonText}>Back to Explore</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="map-screen">
      <Header onBack={() => navigation.goBack()} colors={colors} />
      <View style={styles.webviewWrapper}>
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html: LEAFLET_HTML }}
          onMessage={onMessage}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess={false}
          mixedContentMode="never"
          testID="map-webview"
        />
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={recenterOnUser}
          accessibilityLabel="Recenter on me"
          testID="map-recenter-button"
        >
          <NavigationIcon size={18} color={colors.brandPink} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        {error ? (
          <Text style={styles.footerError}>{error}</Text>
        ) : (
          <Text style={styles.footerText}>
            {places.length} merchants
            {caches.size > 0
              ? ` · ${[...caches.values()].filter((c) => c.isLpPiggy).length} 🐷 Piggies · ${
                  [...caches.values()].filter((c) => !c.isLpPiggy).length
                } caches`
              : ''}
          </Text>
        )}
      </View>

      {selected && (
        <MerchantDetailSheet
          place={selected}
          onClose={() => setSelected(null)}
          colors={colors}
          styles={styles}
        />
      )}

      {!webviewReady && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.brandPink} />
        </View>
      )}
    </View>
  );
};

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

const Header: React.FC<{ onBack: () => void; colors: Palette }> = ({ onBack, colors }) => {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        accessibilityLabel="Back to Explore"
        testID="map-back-button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Map</Text>
      <View style={styles.headerRightSpacer} />
    </View>
  );
};

const MerchantDetailSheet: React.FC<{
  place: BtcMapPlace;
  onClose: () => void;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ place, onClose, colors, styles }) => {
  const days = daysSinceVerified(place);
  const lud16 = lightningAddressOf(place);
  const verifyText =
    days === null
      ? null
      : days === 0
        ? 'Verified today via OSM'
        : days === 1
          ? 'Verified 1 day ago via OSM'
          : `Verified ${days} days ago via OSM`;

  return (
    <View style={styles.sheetBackdrop} testID="merchant-detail-screen">
      <TouchableOpacity style={styles.sheetTapAway} onPress={onClose} activeOpacity={1} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle} testID="merchant-detail-name">
          {place.tags.name ?? 'Unnamed merchant'}
        </Text>
        <Text style={styles.sheetSubtitle}>{formatAddress(place)}</Text>
        <View style={styles.sheetChipRow}>
          {acceptsLightning(place) && (
            <View style={styles.sheetChipPink}>
              <Zap size={12} color={colors.white} strokeWidth={2.5} />
              <Text style={styles.sheetChipPinkText}>Lightning</Text>
            </View>
          )}
          {acceptsOnchain(place) && (
            <View style={styles.sheetChipGrey}>
              <Text style={styles.sheetChipGreyText}>On-chain</Text>
            </View>
          )}
        </View>
        {verifyText && <Text style={styles.sheetVerify}>{verifyText}</Text>}
        <View style={styles.sheetActions}>
          <TouchableOpacity
            style={[styles.sheetButton, !lud16 && styles.sheetButtonDisabled]}
            disabled={!lud16}
            onPress={() => {
              if (!lud16) return;
              onClose();
              // SendSheet pre-fill is handled in milestone 4 alongside the
              // payment plumbing; for now we close the sheet so the user
              // sees the address. TODO(#467): wire to SendSheet when M4
              // adds the lud16 entry-path on the Home tab.
            }}
            testID="merchant-detail-pay-button"
            accessibilityLabel={lud16 ? `Pay ${lud16}` : 'No Lightning Address available'}
          >
            <Zap size={16} color={colors.white} strokeWidth={2.5} />
            <Text style={styles.sheetButtonText}>{lud16 ? 'Pay' : 'No address'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const bboxAround = (lat: number, lng: number, halfDegrees: number): Bbox => ({
  minLon: lng - halfDegrees,
  minLat: lat - halfDegrees,
  maxLon: lng + halfDegrees,
  maxLat: lat + halfDegrees,
});

// Geohash → centroid (lat, lng) — inverse of utils/geohash.ts encoder.
// Used here because cache events publish only the geohash string, not
// raw lat/lon (NIP-GC convention).
const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const decodeGeohash = (gh: string): { lat: number; lng: number } => {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let evenBit = true;
  for (let i = 0; i < gh.length; i += 1) {
    const idx = GEOHASH_BASE32.indexOf(gh[i].toLowerCase());
    if (idx < 0) continue;
    for (let bit = 4; bit >= 0; bit -= 1) {
      const set = (idx >> bit) & 1;
      if (evenBit) {
        const mid = (lonLo + lonHi) / 2;
        if (set) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (set) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { lat: (latLo + latHi) / 2, lng: (lonLo + lonHi) / 2 };
};

// -----------------------------------------------------------------------------
// Leaflet HTML — kept inline so the bundle has no runtime CDN dependency
// for the loader, while tile imagery itself still streams from OSM at use
// time. Communicates with React Native via `window.ReactNativeWebView.
// postMessage`. Two RN→WebView entry-points are exposed: `LP_setViewport`
// and `LP_setMarkers`.
// -----------------------------------------------------------------------------

const LEAFLET_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
    .lp-pin {
      width: 22px; height: 22px; border-radius: 11px;
      background: #EC008C; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    .lp-pin.onchain { background: #F5A623; }
    /* NIP-GC cache pins — diamond shape so they're visually
       distinguishable from circular merchant pins. */
    .lp-cache {
      width: 22px; height: 22px;
      background: #6c7b8a; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      transform: rotate(45deg);
    }
    .lp-cache.piggy { background: #EC008C; }
    .lp-cache.piggy::after {
      content: '🐷';
      transform: rotate(-45deg);
      display: inline-block;
      font-size: 12px;
      line-height: 18px;
      width: 18px;
      height: 18px;
      text-align: center;
    }
    .lp-me {
      width: 14px; height: 14px; border-radius: 7px;
      background: #2D88FF; border: 2px solid #fff;
      box-shadow: 0 0 0 6px rgba(45,136,255,0.25);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const post = (msg) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    const map = L.map('map', { zoomControl: true }).setView([51.5074, -0.1278], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    let meMarker = null;
    let markerLayer = L.layerGroup().addTo(map);
    let cacheLayer = L.layerGroup().addTo(map);

    const debounce = (fn, ms) => {
      let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    };
    const emitBounds = debounce(() => {
      const b = map.getBounds();
      post({ type: 'bounds', bbox: {
        minLon: b.getWest(), minLat: b.getSouth(),
        maxLon: b.getEast(), maxLat: b.getNorth(),
      }});
    }, 350);

    map.on('moveend', emitBounds);
    map.on('zoomend', emitBounds);

    window.LP_setViewport = function(lat, lng, zoom) {
      map.setView([lat, lng], zoom || map.getZoom());
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="lp-me"></div>', iconSize: [14,14] }),
      }).addTo(map);
    };

    window.LP_setMarkers = function(list) {
      markerLayer.clearLayers();
      list.forEach((m) => {
        const cls = 'lp-pin' + (m.lightning ? '' : ' onchain');
        const icon = L.divIcon({ className: '', html: '<div class="' + cls + '"></div>', iconSize: [22, 22] });
        const marker = L.marker([m.lat, m.lng], { icon });
        marker.on('click', () => post({ type: 'markerTap', id: m.id }));
        marker.addTo(markerLayer);
      });
    };

    window.LP_setCaches = function(list) {
      cacheLayer.clearLayers();
      list.forEach((c) => {
        const cls = 'lp-cache' + (c.kind === 'piggy' ? ' piggy' : '');
        const icon = L.divIcon({ className: '', html: '<div class="' + cls + '"></div>', iconSize: [22, 22] });
        const marker = L.marker([c.lat, c.lng], { icon });
        marker.on('click', () => post({ type: 'cacheTap', coord: c.coord }));
        marker.addTo(cacheLayer);
      });
    };

    post({ type: 'ready' });
  </script>
</body>
</html>`;

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: {
      width: 24,
    },
    webviewWrapper: {
      flex: 1,
      position: 'relative',
    },
    webview: {
      flex: 1,
    },
    recenterButton: {
      position: 'absolute',
      right: 14,
      bottom: 14,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
    footer: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    footerText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    footerError: {
      fontSize: 13,
      color: colors.brandPink,
      fontWeight: '600',
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    deniedBody: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 12,
    },
    deniedTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    deniedSubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
    },
    deniedButton: {
      marginTop: 12,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 100,
    },
    deniedButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
    // ----- bottom sheet
    sheetBackdrop: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheetTapAway: {
      flex: 1,
    },
    sheet: {
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 28,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      gap: 8,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
      marginBottom: 6,
    },
    sheetTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
    },
    sheetSubtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
    },
    sheetChipRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 6,
    },
    sheetChipPink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    sheetChipPinkText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '700',
    },
    sheetChipGrey: {
      backgroundColor: colors.divider,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    sheetChipGreyText: {
      color: colors.textSupplementary,
      fontSize: 11,
      fontWeight: '700',
    },
    sheetVerify: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 4,
    },
    sheetActions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 14,
    },
    sheetButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.brandPink,
      paddingVertical: 12,
      borderRadius: 100,
    },
    sheetButtonDisabled: {
      backgroundColor: colors.divider,
    },
    sheetButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '700',
    },
  });

export default MapScreen;
