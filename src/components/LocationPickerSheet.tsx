import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { WebView } from 'react-native-webview';
import { MapPin, Check, X } from 'lucide-react-native';
import { LibreMiniMap } from './LibreMiniMap';
const USE_LIBRE_MAP = process.env.EXPO_PUBLIC_USE_LIBRE_MAP === '1';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { getDevPinnedLocation } from '../utils/devLocation';
import {
  LEAFLET_BASE_CSS,
  LEAFLET_HEAD_TAGS,
  LEAFLET_MAP_BACKGROUND_CSS,
  LEAFLET_SCRIPT_TAG,
  POST_BRIDGE_JS,
  tileLayerJs,
} from '../utils/mapWebview/tiles';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Where the map opens centred + the pin starts. Defaults to a
   *  world-ish view if the caller has no location yet. */
  initialLat: number | null;
  initialLon: number | null;
  /** Fires with the chosen coordinate when the user confirms. */
  onConfirm: (lat: number, lon: number) => void;
}

/**
 * Bottom-sheet location picker — an interactive Leaflet map with a
 * draggable pin. The user drags the pin (or taps the map to move it) to
 * the exact spot they stashed the Piglet, then taps "Use this location".
 *
 * The map lives in a WebView (same Leaflet transport as ExploreMiniMap /
 * MapScreen — no native map SDK). The WebView posts the pin's lat/lon
 * back on every drag / tap; the parent only commits it on confirm.
 */
const LocationPickerSheet: React.FC<Props> = ({
  visible,
  onClose,
  initialLat,
  initialLon,
  onConfirm,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  // Map gets a fixed slice of the window (50%) so the sheet has a
  // determinate height for Gorhom's dynamic sizing to measure. Plenty of
  // pin-placement area, leaves the wizard header peeking behind, scales
  // with the device. Using window height (not screen) — that excludes
  // the system UI so the math stays right with a tall handle / nav bar.
  const mapHeight = useMemo(() => Math.round(Dimensions.get('window').height * 0.5), []);

  // Where the map first centres. `null` until resolved — we wait for
  // the GPS lookup (or the UK fallback timer) before rendering the
  // WebView, so the map never has to remount + re-fetch Leaflet when
  // the location lands a few hundred ms after the sheet opens. Order
  // of preference:
  //   1. caller-supplied `initialLat`/`Lon` (edit-mode + already-pinned)
  //   2. dev-pinned location (emulator parity — see useCompassNavigation)
  //   3. `Location.getLastKnownPositionAsync` (instant, returns cached fix)
  //   4. UK fallback (54.0, -2.0) at low zoom
  const [resolvedStart, setResolvedStart] = useState<{
    lat: number;
    lon: number;
    zoom: number;
  } | null>(null);
  const hasInitialPin = initialLat !== null && initialLon !== null;
  const [picked, setPicked] = useState<{ lat: number; lon: number }>({ lat: 0, lon: 0 });
  // `picked` always has a value (the marker has to render somewhere), so
  // we need a second flag to know whether the user has affirmed it. When
  // the caller passed a real initialLat/Lon (i.e. we're editing an
  // existing pin), treat that as already-chosen.
  const [userMoved, setUserMoved] = useState<boolean>(hasInitialPin);

  useEffect(() => {
    if (!visible) {
      sheetRef.current?.dismiss();
      setResolvedStart(null);
      return;
    }
    sheetRef.current?.present();
    let cancelled = false;
    const seed = (lat: number, lon: number, zoom: number) => {
      if (cancelled) return;
      setResolvedStart({ lat, lon, zoom });
      setPicked({ lat, lon });
      setUserMoved(hasInitialPin);
    };
    if (hasInitialPin) {
      seed(initialLat as number, initialLon as number, 16);
      return () => {
        cancelled = true;
      };
    }
    // Emulator override — same source the rest of the app uses so dev
    // pins agree across screens.
    const pinned = getDevPinnedLocation();
    if (pinned) {
      seed(pinned.lat, pinned.lon, 16);
      return () => {
        cancelled = true;
      };
    }
    // Last-known is nearly-instant (returns the OS's cached fix) so
    // the sheet doesn't feel laggy. If null / denied, fall back to UK.
    Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 })
      .then((known) => {
        if (known) seed(known.coords.latitude, known.coords.longitude, 16);
        else seed(54.0, -2.0, 5);
      })
      .catch(() => seed(54.0, -2.0, 5));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialLat, initialLon]);

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleConfirm = () => {
    onConfirm(picked.lat, picked.lon);
    onClose();
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      // No snapPoints — let Gorhom's dynamic sizing fit the sheet to the
      // content (title + map + coord + button + padding). For that to
      // measure cleanly, *nothing* below can use flex:1 to "fill the
      // sheet" — the map gets an explicit height instead. Otherwise the
      // sheet sizes to content while the content waits for the sheet to
      // tell it how tall to be, and the WebView paints into a 0-px box.
      //
      // enableContentPanningGesture={false} keeps the map pannable —
      // Gorhom's content-pan gesture would otherwise hijack map drags
      // and turn them into sheet-dismiss swipes. Handle bar + backdrop
      // + BackHandler still cover every dismiss path.
      enableContentPanningGesture={false}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        {/* Close button — `enableContentPanningGesture={false}` means
            swipe-to-dismiss only works on the handle bar at the top of
            the sheet (otherwise the map's own pan gesture would fight
            it). A discoverable X button covers the dismiss path users
            actually reach for. */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          accessibilityLabel="Close location picker"
          testID="location-picker-close"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={20} color={colors.textSupplementary} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.title}>Where did you hide it?</Text>
        <Text style={styles.subtitle}>Drag the pin — or tap the map — to mark the exact spot.</Text>

        <View style={[styles.mapWrap, { height: mapHeight }]}>
          {resolvedStart === null ? (
            <View style={styles.mapLoading}>
              <ActivityIndicator color={colors.brandPink} />
            </View>
          ) : USE_LIBRE_MAP ? (
            // LibreMiniMap with the crosshair overlay + onBoundsChange
            // gives us the same pick-by-pan UX as the Leaflet draggable
            // marker, but with the native renderer. We treat every
            // post-mount region change as user intent (the initial
            // mount fires once at the resolved-start coords; everything
            // after is the user panning to a new spot).
            <LibreMiniMap
              lat={resolvedStart.lat}
              lon={resolvedStart.lon}
              userAccuracyMetres={null}
              merchants={[]}
              caches={[]}
              events={[]}
              defaultZoom={resolvedStart.zoom}
              interactive
              fill
              crosshair
              onBoundsChange={(bbox) => {
                // Centre of the bbox is where the crosshair sits.
                const lat = (bbox.minLat + bbox.maxLat) / 2;
                const lon = (bbox.minLon + bbox.maxLon) / 2;
                setPicked({ lat, lon });
                setUserMoved(true);
              }}
            />
          ) : (
          <WebView
            originWhitelist={['*']}
            source={{ html: makeHtml(resolvedStart.lat, resolvedStart.lon, resolvedStart.zoom) }}
            onMessage={(e) => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (
                  msg.type === 'pin' &&
                  typeof msg.lat === 'number' &&
                  typeof msg.lon === 'number'
                ) {
                  setPicked({ lat: msg.lat, lon: msg.lon });
                  // Only count drag-end / tap as user intent — the
                  // map's initial emit on load is just reporting the
                  // marker's default seat, not a choice.
                  if (msg.userMoved) setUserMoved(true);
                }
              } catch {
                // Ignore malformed bridge messages.
              }
            }}
            style={styles.webview}
          />
          )}
        </View>

        <View style={styles.coordRow}>
          <MapPin size={16} color={colors.brandPink} strokeWidth={2.5} />
          {userMoved ? (
            <Text style={styles.coordText} testID="location-picker-coord">
              {picked.lat.toFixed(5)}, {picked.lon.toFixed(5)}
            </Text>
          ) : (
            <Text style={styles.coordPlaceholder}>Tap or drag the pin to mark a location</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.confirmButton, !userMoved && styles.confirmButtonDisabled]}
          onPress={handleConfirm}
          disabled={!userMoved}
          testID="location-picker-confirm"
          accessibilityLabel="Use this location"
          accessibilityState={{ disabled: !userMoved }}
        >
          <Check size={18} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.confirmButtonText}>Use this location</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

// Leaflet HTML with a single draggable marker. Posts `{type:'pin',lat,
// lon,userMoved}` on every change. `userMoved` is false on the initial
// post (just reporting the marker's default seat) and true after the
// user drags it or taps the map — RN uses that to decide whether to
// show "Tap or drag…" or the coords. Mirrors the pin language of
// ExploreMiniMap / MapScreen.
const makeHtml = (lat: number, lon: number, zoom: number): string => `<!DOCTYPE html>
<html>
<head>
  ${LEAFLET_HEAD_TAGS}
  <style>
    ${LEAFLET_BASE_CSS}
    ${LEAFLET_MAP_BACKGROUND_CSS}
    .lp-drop{width:20px;height:20px;border-radius:10px;background:#EC008C;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.45)}
    .leaflet-control-attribution{font-size:9px}
  </style>
</head>
<body>
<div id="map"></div>
${LEAFLET_SCRIPT_TAG}
<script>
  ${POST_BRIDGE_JS}
  const map=L.map('map',{zoomControl:true,minZoom:3,maxZoom:19}).setView([${lat},${lon}],${zoom});
  ${tileLayerJs()}
  const icon=L.divIcon({className:'',html:'<div class="lp-drop"></div>',iconSize:[20,20],iconAnchor:[10,10]});
  const marker=L.marker([${lat},${lon}],{icon:icon,draggable:true}).addTo(map);
  const emit=(userMoved)=>{const p=marker.getLatLng();post({type:'pin',lat:p.lat,lon:p.lng,userMoved:!!userMoved});};
  marker.on('dragend',()=>emit(true));
  map.on('click',(e)=>{marker.setLatLng(e.latlng);emit(true);});
  post({type:'ready'});
  emit(false);
</script>
</body></html>`;

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: { backgroundColor: colors.divider, width: 40 },
    // No flex:1 — dynamic sizing means content drives sheet height, not
    // the other way round.
    content: { paddingHorizontal: 16, paddingBottom: 24 },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textHeader,
      marginTop: 4,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
      marginBottom: 12,
    },
    mapWrap: {
      // Height is set inline (50% of window) so it scales with the
      // device; everything else lives here.
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    webview: { flex: 1, backgroundColor: 'transparent' },
    mapLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButton: {
      position: 'absolute',
      top: 8,
      right: 16,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
    coordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 12,
      marginBottom: 12,
    },
    coordText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textHeader,
    },
    coordPlaceholder: {
      fontSize: 13,
      fontStyle: 'italic',
      color: colors.textSupplementary,
    },
    confirmButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      borderRadius: 100,
      paddingVertical: 14,
    },
    confirmButtonDisabled: { opacity: 0.4 },
    confirmButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  });

export default LocationPickerSheet;
