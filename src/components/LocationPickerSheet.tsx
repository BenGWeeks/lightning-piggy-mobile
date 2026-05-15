import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler, Dimensions } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { WebView } from 'react-native-webview';
import { MapPin, Check } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

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

  // Fallback centre when the caller has no fix yet — central UK is a
  // reasonable neutral default for this app's user base; the user will
  // pan to wherever they actually are.
  const startLat = initialLat ?? 54.0;
  const startLon = initialLon ?? -2.0;
  const startZoom = initialLat !== null ? 16 : 5;

  // Live pin position reported by the WebView. Seeded with the start
  // coordinate so "Use this location" works even before the first drag.
  const [picked, setPicked] = useState<{ lat: number; lon: number }>({
    lat: startLat,
    lon: startLon,
  });

  useEffect(() => {
    if (visible) {
      setPicked({ lat: startLat, lon: startLon });
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
        <Text style={styles.title}>Where did you hide it?</Text>
        <Text style={styles.subtitle}>Drag the pin — or tap the map — to mark the exact spot.</Text>

        <View style={[styles.mapWrap, { height: mapHeight }]}>
          <WebView
            originWhitelist={['*']}
            source={{ html: makeHtml(startLat, startLon, startZoom) }}
            onMessage={(e) => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (
                  msg.type === 'pin' &&
                  typeof msg.lat === 'number' &&
                  typeof msg.lon === 'number'
                ) {
                  setPicked({ lat: msg.lat, lon: msg.lon });
                }
              } catch {
                // Ignore malformed bridge messages.
              }
            }}
            style={styles.webview}
          />
        </View>

        <View style={styles.coordRow}>
          <MapPin size={16} color={colors.brandPink} strokeWidth={2.5} />
          <Text style={styles.coordText} testID="location-picker-coord">
            {picked.lat.toFixed(5)}, {picked.lon.toFixed(5)}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.confirmButton}
          onPress={handleConfirm}
          testID="location-picker-confirm"
          accessibilityLabel="Use this location"
        >
          <Check size={18} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.confirmButtonText}>Use this location</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

// Leaflet HTML with a single draggable marker. Posts `{type:'pin',lat,lon}`
// on drag-end and on map tap (tap moves the marker). Mirrors the pin
// language of ExploreMiniMap / MapScreen.
const makeHtml = (lat: number, lon: number, zoom: number): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#eee}
    .lp-drop{width:20px;height:20px;border-radius:10px;background:#EC008C;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.45)}
    .leaflet-control-attribution{font-size:9px}
  </style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const post=(m)=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const map=L.map('map',{zoomControl:true,minZoom:3,maxZoom:19}).setView([${lat},${lon}],${zoom});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
  const icon=L.divIcon({className:'',html:'<div class="lp-drop"></div>',iconSize:[20,20],iconAnchor:[10,10]});
  const marker=L.marker([${lat},${lon}],{icon:icon,draggable:true}).addTo(map);
  const emit=()=>{const p=marker.getLatLng();post({type:'pin',lat:p.lat,lon:p.lng});};
  marker.on('dragend',emit);
  map.on('click',(e)=>{marker.setLatLng(e.latlng);emit();});
  post({type:'ready'});
  emit();
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
    confirmButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      borderRadius: 100,
      paddingVertical: 14,
    },
    confirmButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  });

export default LocationPickerSheet;
