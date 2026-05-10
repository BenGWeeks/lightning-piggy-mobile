import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as Location from 'expo-location';
import { ChevronLeft, ChevronRight, MapPin, PiggyBank, RefreshCw } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import { encodeGeohash, geohashPrefixes } from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';
import { type ParsedCache } from '../services/nostrPlacesService';
import { subscribeNearbyCaches } from '../services/nostrPlacesPublisher';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Discover sub-screen for the Hunt feature (#468). Subscribes to NIP-GC
 * kind 37516 listings whose `g` tag falls inside the user's coarse
 * geohash neighbourhood (precision 5 ≈ 5 km). Renders Lightning Piggies
 * (com.lightningpiggy.app label) and standard NIP-GC caches (treasures.to,
 * TapTheSatsMap, etc.) in one list with a different glyph per cache
 * type. Tap → HuntPiggyDetailScreen for the full listing + threads.
 */
const HuntDiscoverScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [caches, setCaches] = useState<Map<string, ParsedCache>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const closerRef = useRef<(() => void) | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCaches(new Map());
    closerRef.current?.();
    try {
      // Dev-only emulator fallback first (see `getDevPinnedLocation`).
      const pinned = getDevPinnedLocation();
      let lat: number;
      let lon: number;
      if (pinned) {
        lat = pinned.lat;
        lon = pinned.lon;
      } else {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          setError(
            'Location permission required to discover nearby caches. We use a coarse 5 km area, not your exact location.',
          );
          setLoading(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      }
      const myGeohash = encodeGeohash(lat, lon, 7);
      // Coarse 5-char prefix ≈ 5 km tile — broad enough that one query
      // covers the user's neighbourhood without enumerating cells.
      const prefixes = geohashPrefixes(myGeohash, 5).filter((p) => p.length === 5);
      const closer = subscribeNearbyCaches(prefixes, (cache) => {
        // De-dupe by coord — replaceable events; latest wins.
        setCaches((prev) => {
          const existing = prev.get(cache.coord);
          if (existing && existing.createdAt >= cache.createdAt) return prev;
          const next = new Map(prev);
          next.set(cache.coord, cache);
          return next;
        });
      });
      closerRef.current = closer;
      // Drop the spinner after a beat — relays stream events
      // continuously; we don't wait for EOSE.
      setTimeout(() => setLoading(false), 1500);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    return () => {
      closerRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedCaches = useMemo(() => {
    return [...caches.values()].sort((a, b) => {
      // Show LP Piggies first (richer UX), then by recency.
      if (a.isLpPiggy !== b.isLpPiggy) return a.isLpPiggy ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }, [caches]);

  return (
    <View style={styles.container} testID="hunt-discover-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Hunt"
          testID="hunt-discover-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Discover</Text>
        <TouchableOpacity
          onPress={reload}
          accessibilityLabel="Refresh"
          testID="hunt-discover-refresh-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <RefreshCw size={20} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {loading && caches.size === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPink} />
          <Text style={styles.subtle}>Looking for caches near you…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={reload}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : sortedCaches.length === 0 ? (
        <View style={styles.center} testID="hunt-discover-empty-state">
          <PiggyBank size={56} color={colors.textSupplementary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No caches nearby yet</Text>
          <Text style={styles.subtle}>
            We searched a ~5 km area. Hide the first one with the &ldquo;Hide a Piggy&rdquo; button
            on the Hunt hub.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sortedCaches}
          keyExtractor={(c) => c.coord}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <CacheRow
              cache={item}
              index={index}
              colors={colors}
              styles={styles}
              onPress={() => navigation.navigate('HuntPiggyDetail', { coord: item.coord })}
            />
          )}
        />
      )}
    </View>
  );
};

const CacheRow: React.FC<{
  cache: ParsedCache;
  /** FlatList index — drives a deterministic `hunt-discover-row-N`
   * testID alongside the data-stable `hunt-discover-row-${cache.d}`
   * so Maestro flows can target the first row by `id: 'hunt-discover-row-0'`
   * without coordinate taps (Copilot review #488). */
  index: number;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}> = ({ cache, index, colors, styles, onPress }) => (
  <TouchableOpacity
    style={styles.row}
    onPress={onPress}
    testID={`hunt-discover-row-${cache.d}`}
    accessibilityLabel={cache.name}
  >
    {/* Sibling testID that's deterministic by position. Maestro can match
        either id; the data-stable one is preferred when the d-tag is known. */}
    <View testID={`hunt-discover-row-${index}`} pointerEvents="none" />
    <View style={[styles.iconWrap, cache.isLpPiggy ? styles.iconLp : styles.iconStandard]}>
      {cache.isLpPiggy ? (
        <PiggyBank size={22} color={colors.white} strokeWidth={2} />
      ) : (
        <MapPin size={22} color={colors.white} strokeWidth={2} />
      )}
    </View>
    {cache.imageUrl ? (
      <Image source={{ uri: cache.imageUrl }} style={styles.thumb} resizeMode="cover" />
    ) : null}
    <View style={styles.rowMain}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {cache.name}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {cache.isLpPiggy ? '🐷 Lightning Piggy' : 'NIP-GC cache'}
        {cache.cacheType ? ` · ${cache.cacheType}` : ''}
        {cache.size ? ` · ${cache.size}` : ''}
        {cache.difficulty ? ` · D${cache.difficulty}` : ''}
        {cache.terrain ? ` / T${cache.terrain}` : ''}
      </Text>
      {cache.description ? (
        <Text style={styles.rowSub} numberOfLines={1}>
          {cache.description}
        </Text>
      ) : null}
    </View>
    <ChevronRight size={20} color={colors.textSupplementary} />
  </TouchableOpacity>
);

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
      gap: 12,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    subtle: { fontSize: 14, color: colors.textSupplementary, textAlign: 'center', lineHeight: 20 },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 6,
      textAlign: 'center',
    },
    errorText: {
      fontSize: 14,
      color: colors.brandPink,
      textAlign: 'center',
      lineHeight: 20,
    },
    retryButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 100,
      marginTop: 8,
    },
    retryButtonText: { color: colors.white, fontWeight: '700', fontSize: 14 },
    listContent: { padding: 16, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 10,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconLp: { backgroundColor: colors.brandPink },
    iconStandard: { backgroundColor: colors.textSupplementary },
    thumb: {
      width: 44,
      height: 44,
      borderRadius: 8,
      backgroundColor: colors.divider,
    },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '700', color: colors.textHeader },
    rowMeta: { fontSize: 12, color: colors.textSupplementary, marginTop: 2 },
    rowSub: { fontSize: 12, color: colors.textSupplementary, marginTop: 2, fontStyle: 'italic' },
  });

export default HuntDiscoverScreen;
