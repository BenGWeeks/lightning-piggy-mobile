import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { ChevronLeft, ChevronRight, MapPin, PiggyBank, Plus, Search } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import { type ParsedCache } from '../services/nostrPlacesService';
import { subscribeNearbyCaches } from '../services/nostrPlacesPublisher';
import {
  decodeGeohash,
  encodeGeohash,
  formatDistance,
  geohashPrefixes,
  haversineMetres,
} from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * **Geo-caches** sub-screen — single-purpose discovery + creation
 * page for NIP-GC caches (Piglets + standard NIP-GC). Per UX
 * feedback (May 2026), the prior "Hunt hub" + "Discover" two-screen
 * split was collapsed into this one: a mini-map at the top, a `+`
 * button in the header that opens the create flow, and a list of
 * nearby caches below sorted by distance with a search field.
 *
 * Most users find caches; a small fraction create them. Putting
 * "Hide a Piglet" behind the `+` icon (instead of a full secondary
 * card) keeps the page focused on the common case.
 */
const HuntScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [caches, setCaches] = useState<Map<string, ParsedCache>>(new Map());
  const [untrustedHidden, setUntrustedHidden] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Web-of-trust filter. Refs so the subscription callback always
  // reads the current `isTrusted` predicate without resubscribing.
  const { isTrusted, filterEnabled } = useTrustGraph();
  const isTrustedRef = useRef(isTrusted);
  useEffect(() => {
    isTrustedRef.current = isTrusted;
  }, [isTrusted]);

  // Location resolve — dev-fallback first, then real GPS.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pinned = getDevPinnedLocation();
      if (pinned) {
        if (!cancelled) setPos(pinned);
        return;
      }
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          setLoading(false);
          return;
        }
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) setPos({ lat: fix.coords.latitude, lon: fix.coords.longitude });
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cache subscription — kicks off once we have a fix.
  useEffect(() => {
    if (!pos) return;
    const myGeohash = encodeGeohash(pos.lat, pos.lon, 7);
    const prefixes = geohashPrefixes(myGeohash, 5).filter((p) => p.length === 5);
    const closer = subscribeNearbyCaches(prefixes, (c) => {
      // WoT filter — see `trustGraphService` for the threat model.
      if (filterEnabled && !isTrustedRef.current(c.hiderPubkey)) {
        setUntrustedHidden((n) => n + 1);
        return;
      }
      setCaches((prev) => {
        const existing = prev.get(c.coord);
        if (existing && existing.createdAt >= c.createdAt) return prev;
        const next = new Map(prev);
        next.set(c.coord, c);
        return next;
      });
    });
    // Drop the spinner after a beat — relays stream continuously, no EOSE wait.
    const settleTimer = setTimeout(() => setLoading(false), 1500);
    return () => {
      closer();
      clearTimeout(settleTimer);
    };
  }, [pos, filterEnabled]);

  const sortedCaches = useMemo(() => {
    const items = [...caches.values()].map((cache) => {
      const center = cache.geohash ? decodeGeohash(cache.geohash) : null;
      const distance =
        pos && center
          ? haversineMetres({ lat: pos.lat, lon: pos.lon }, { lat: center.lat, lon: center.lng })
          : Number.POSITIVE_INFINITY;
      return { cache, distance };
    });
    items.sort((a, b) => a.distance - b.distance);
    return items;
  }, [caches, pos]);

  const filteredCaches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedCaches;
    return sortedCaches.filter(({ cache }) => {
      const hay = [cache.name, cache.description, cache.cacheType ?? '', cache.size ?? '']
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedCaches, searchQuery]);

  return (
    <View style={styles.container} testID="geocaches-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Explore"
          testID="hunt-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Geo-caches</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('HuntCreate')}
          accessibilityLabel="Hide a Piglet"
          testID="hunt-create-piggy-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Plus size={22} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredCaches}
        keyExtractor={({ cache }) => cache.coord}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* Mini-map at the top — same component the hub uses. Tap
                opens the full Map. Cache pins only (no merchants /
                events) so the page stays focused. */}
            <View style={styles.mapWrap}>
              <ExploreMiniMap
                lat={pos?.lat ?? null}
                lon={pos?.lon ?? null}
                merchants={[]}
                caches={[...caches.values()]}
                events={[]}
                onTapMap={() => navigation.navigate('Map')}
              />
            </View>

            <View style={styles.searchRow}>
              <Search size={16} color={colors.textSupplementary} strokeWidth={2.5} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search geo-caches…"
                placeholderTextColor={colors.textSupplementary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                testID="hunt-search-input"
              />
            </View>

            {untrustedHidden > 0 ? (
              <Text style={styles.trustNote} testID="hunt-discover-trust-note">
                {untrustedHidden} {untrustedHidden === 1 ? 'cache' : 'caches'} hidden from outside
                your trust graph. An unverified geo-cache can be a lure — only listings from people
                you (or your follows) trust are shown.
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <CacheRow
            cache={item.cache}
            distance={item.distance}
            index={index}
            colors={colors}
            styles={styles}
            onPress={() => navigation.navigate('HuntPiggyDetail', { coord: item.cache.coord })}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center} testID="hunt-discover-loading">
              <ActivityIndicator color={colors.brandPink} />
              <Text style={styles.subtle}>Looking for geo-caches near you…</Text>
            </View>
          ) : searchQuery.trim() !== '' ? (
            <Text style={styles.emptySearchText}>
              Nothing matches “{searchQuery.trim()}”. Try a cache type, size, or location keyword.
            </Text>
          ) : (
            <View style={styles.center} testID="hunt-discover-empty-state">
              <PiggyBank size={56} color={colors.textSupplementary} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>No geo-caches nearby yet</Text>
              <Text style={styles.subtle}>
                We searched a ~5 km area. Tap{' '}
                <Text style={{ fontWeight: '700', color: colors.brandPink }}>+</Text> above to hide
                the first Piglet.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
};

const CacheRow: React.FC<{
  cache: ParsedCache;
  distance: number;
  // Deterministic-by-position testID so Maestro can target row 0 without coords.
  index: number;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}> = ({ cache, distance, index, colors, styles, onPress }) => (
  <TouchableOpacity
    style={styles.row}
    onPress={onPress}
    testID={`hunt-discover-row-${cache.d}`}
    accessibilityLabel={cache.name}
  >
    <View testID={`hunt-discover-row-${index}`} pointerEvents="none" />
    {cache.imageUrl ? (
      <Image source={{ uri: cache.imageUrl }} style={styles.thumb} resizeMode="cover" />
    ) : (
      <View style={[styles.iconWrap, cache.isLpPiggy ? styles.iconLp : styles.iconStandard]}>
        {cache.isLpPiggy ? (
          <PiggyBank size={22} color={colors.white} strokeWidth={2} />
        ) : (
          <MapPin size={22} color={colors.white} strokeWidth={2} />
        )}
      </View>
    )}
    <View style={styles.rowMain}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {cache.name}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {cache.isLpPiggy ? 'Piglet' : 'NIP-GC cache'}
        {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
        {cache.cacheType ? ` · ${cache.cacheType}` : ''}
        {cache.size ? ` · ${cache.size}` : ''}
        {cache.difficulty ? ` · D${cache.difficulty}` : ''}
        {cache.terrain ? ` / T${cache.terrain}` : ''}
      </Text>
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
    mapWrap: {
      marginTop: 12,
      marginBottom: 8,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 8,
      backgroundColor: colors.surface,
      borderRadius: 100,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.textHeader,
      paddingVertical: 4,
    },
    trustNote: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
    listContent: { paddingBottom: 32 },
    center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    subtle: { fontSize: 14, color: colors.textSupplementary, textAlign: 'center', lineHeight: 20 },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 6,
      textAlign: 'center',
    },
    emptySearchText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      padding: 24,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginHorizontal: 16,
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
  });

export default HuntScreen;
