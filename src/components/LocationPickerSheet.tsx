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
import { MapPin, Check, X } from 'lucide-react-native';
import { LibreMiniMap } from './LibreMiniMap';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { getDevPinnedLocation } from '../utils/devLocation';

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
  //   3. `Location.getCurrentPositionAsync` (fresh GPS — up to 1.5 s)
  //   4. `Location.getLastKnownPositionAsync` (instant, returns cached fix)
  //   5. UK fallback (54.0, -2.0) at low zoom
  // We race (3) against a 1.5 s timeout that falls through to (4); a
  // fresh fix arrives before the user pans in the common case. The
  // bare last-known path is what caused #595 — a 10-min-old fix from
  // elsewhere in town quietly seeded the map.
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
  // MapLibre's onRegionDidChange fires once on mount at the initial
  // centre — we must NOT count that as user intent or the confirm
  // button enables without any actual interaction. This ref swallows
  // the first emission; subsequent events are real pans.
  const initialBoundsFiredRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      sheetRef.current?.dismiss();
      setResolvedStart(null);
      return;
    }
    sheetRef.current?.present();
    let cancelled = false;
    let seeded = false;
    const seed = (lat: number, lon: number, zoom: number) => {
      if (cancelled || seeded) return;
      seeded = true;
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
    // Fast-first / fresh-second: kick off a fresh GPS fix immediately,
    // but race it against a 1.5 s timeout that falls back to the OS's
    // last-known fix so the sheet never hangs. Whichever lands first
    // seeds the map (`seeded` guard); a stale fresh-fix arriving after
    // we already fell back to last-known is dropped.
    //
    // Why not bare last-known (the pre-#595 behaviour)? `maxAge: 10 min`
    // means a fix from the *same town* a few streets away counts as
    // "known" — the map opens centred on yesterday's coffee shop.
    const freshTimeout = setTimeout(() => {
      Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 })
        .then((known) => {
          if (known) seed(known.coords.latitude, known.coords.longitude, 16);
          else seed(54.0, -2.0, 5);
        })
        .catch(() => seed(54.0, -2.0, 5));
    }, 1500);
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((pos) => {
        clearTimeout(freshTimeout);
        seed(pos.coords.latitude, pos.coords.longitude, 16);
      })
      .catch(() => {
        // Permission denied / hardware failure — let the timeout path
        // take over (last-known → UK fallback).
      });
    return () => {
      cancelled = true;
      clearTimeout(freshTimeout);
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
          ) : (
            // LibreMiniMap with the crosshair overlay + onBoundsChange
            // gives a pick-by-pan UX: user pans the map so the centred
            // crosshair lands on the chosen spot. We treat every
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
                // Swallow the initial mount fire (MapLibre emits
                // onRegionDidChange once at the resolved-start coords
                // before any user input). Subsequent events are real
                // pans — those count as user intent.
                if (!initialBoundsFiredRef.current) {
                  initialBoundsFiredRef.current = true;
                  return;
                }
                setUserMoved(true);
              }}
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
