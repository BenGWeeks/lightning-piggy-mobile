import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import * as Location from 'expo-location';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  PiggyBank,
  Search,
  SlidersHorizontal,
} from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import HuntFilterSheet, { countActiveFilters } from '../components/HuntFilterSheet';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import { LibreMiniMap } from '../components/LibreMiniMap';
import { LpPayoutBadge } from '../components/LpPayoutBadge';
import { CacheDetailSheet } from '../components/CacheDetailSheet';
import { useUserLocation } from '../contexts/UserLocationContext';
import LegendSheet from '../components/LegendSheet';
import { type ParsedCache } from '../services/nostrPlacesService';
import { fetchCachesByAuthor, subscribeNearbyCaches } from '../services/nostrPlacesPublisher';
import { useNostr } from '../contexts/NostrContext';
import { loadCachedCaches, peekCachedCachesSync, saveCaches } from '../services/nostrPlacesStorage';
import {
  decodeGeohash,
  encodeGeohash,
  formatDistance,
  geohashNeighbours,
  haversineMetres,
} from '../utils/geohash';

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
  const { pubkey, relays, profile } = useNostr();
  const [pos, setPos] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(
    null,
  );
  // Live position for the user dot — refreshes as the user walks
  // around without re-firing the nearby-cache subscription (which is
  // keyed on the initial `pos`).
  const { pos: livePos } = useUserLocation();
  const [caches, setCaches] = useState<Map<string, ParsedCache>>(
    () => new Map(peekCachedCachesSync().map((c) => [c.coord, c])),
  );
  // Pull-to-refresh: re-load the on-disk cache AND query relays for
  // every kind 37516 listing by the signed-in user, so the rail
  // includes the user's own historical Piggies even if the nearby
  // subscription never echoed them back (same gap MyPiglets covers).
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // Hard 8 s ceiling — even if fetchCachesByAuthor / loadCachedCaches
    // hang somehow, the spinner clears so the user isn't blocked from
    // tapping elsewhere on the page. fetchCachesByAuthor already has a
    // 5 s maxWait but disk IO / device sleep can still stretch the
    // wall-clock. Pre-fix Ben hit a state where pull-to-refresh
    // appeared to block navigation entirely.
    const safetyTimer = setTimeout(() => setRefreshing(false), 8000);
    try {
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const [cached, mine] = await Promise.all([
        loadCachedCaches(),
        pubkey
          ? fetchCachesByAuthor(pubkey, readRelays.length > 0 ? readRelays : undefined).catch(
              () => [] as ParsedCache[],
            )
          : Promise.resolve([] as ParsedCache[]),
      ]);
      setCaches((prev) => {
        const next = new Map(prev);
        for (const c of cached) {
          const existing = next.get(c.coord);
          if (!existing || c.createdAt > existing.createdAt) next.set(c.coord, c);
        }
        for (const c of mine) {
          const existing = next.get(c.coord);
          if (!existing || c.createdAt > existing.createdAt) next.set(c.coord, c);
        }
        return next;
      });
    } finally {
      clearTimeout(safetyTimer);
      setRefreshing(false);
    }
  }, [pubkey, relays]);

  // Hydrate from AsyncStorage so the list paints instantly on cold
  // start while the live relay sub backfills.
  useEffect(() => {
    let cancelled = false;
    loadCachedCaches().then((cs) => {
      if (cancelled || cs.length === 0) return;
      setCaches((prev) => {
        if (prev.size > 0) return prev;
        const m = new Map<string, ParsedCache>();
        for (const c of cs) m.set(c.coord, c);
        return m;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // Write-through (debounced) so the next cold start has fresh data.
  useEffect(() => {
    if (caches.size === 0) return;
    const t = setTimeout(() => saveCaches([...caches.values()]), 1500);
    return () => clearTimeout(t);
  }, [caches]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Web-of-trust filter. `isTrusted` is tier-aware (short-circuits to
  // true for the 'all' tier) and is applied at render time in
  // `sortedCaches`, so flipping the tier re-filters instantly.
  const { isTrusted, wotTier } = useTrustGraph();
  // Visible bbox from the mini-map at the top of the screen. The list
  // below filters to caches whose decoded geohash lies inside this
  // bbox, so "zoom out → see more" emerges naturally and there's no
  // distance chip row to bias the user.
  const [mapBbox, setMapBbox] = useState<{
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  } | null>(null);
  // NIP-GC difficulty / terrain are integer 1-5 scales (geocaching
  // convention). Multi-select Sets so a user can pick e.g. D1 + D3
  // (skip the cunning level in the middle). Empty Set = no filter.
  const [selectedDifficulties, setSelectedDifficulties] = useState<Set<number>>(new Set());
  const [selectedTerrains, setSelectedTerrains] = useState<Set<number>>(new Set());
  // Whether the bottom-sheet filter UI is open.
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [legendVisible, setLegendVisible] = useState(false);
  // Mini-map pin-tap → opens the shared `CacheDetailSheet`, same UX
  // as the Explore mini-map + the full MapScreen. PR #630 follow-up.
  const [selectedCache, setSelectedCache] = useState<ParsedCache | null>(null);
  // Map-touch tracking removed when the map moved out of the
  // FlatList header (commit eedd82e follow-up). Map and list are now
  // siblings, so touches on the map don't reach the FlatList at all.
  // Cache type filter — empty set = show every type (default). Built
  // dynamically from whatever types are present in the current caches
  // dataset; selected entries OR together so the list doesn't filter
  // to zero when a hider uses an unusual cache type.
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  // Location resolve.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          setLoading(false);
          return;
        }
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!cancelled) {
          // `coords.accuracy` is 1-σ horizontal accuracy in metres on
          // expo-location; null on platforms that don't report it.
          // Threaded through to ExploreMiniMap so the accuracy halo
          // can render around the "you" dot (shared
          // drawAccuracyCircle in src/utils/mapMeDot.ts).
          setPos({
            lat: fix.coords.latitude,
            lon: fix.coords.longitude,
            accuracy: typeof fix.coords.accuracy === 'number' ? fix.coords.accuracy : null,
          });
        }
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
    // 9 prefixes (user's precision-5 tile + 8 neighbours) so caches
    // hidden in adjacent ~5 km tiles surface too. The Explore mini-map
    // got the same treatment earlier in this branch. Pre-#631 the
    // previous `geohashPrefixes(...).filter((p) => p.length === 5)`
    // returned only the user's own truncation, so a cache 500 m across
    // a tile boundary stayed invisible.
    const prefixes = geohashNeighbours(encodeGeohash(pos.lat, pos.lon, 5));
    // Load every nearby cache regardless of trust — the WoT filter is
    // applied at render time (sortedCaches), so flipping the tier
    // re-filters instantly with no re-subscribe or relay round-trip.
    const closer = subscribeNearbyCaches(prefixes, (c) => {
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
  }, [pos]);

  const sortedCaches = useMemo(() => {
    let items = [...caches.values()].map((cache) => {
      const center = cache.geohash ? decodeGeohash(cache.geohash) : null;
      const distance =
        pos && center
          ? haversineMetres({ lat: pos.lat, lon: pos.lon }, { lat: center.lat, lon: center.lng })
          : Number.POSITIVE_INFINITY;
      return { cache, distance };
    });
    items.sort((a, b) => a.distance - b.distance);
    // Drop NIP-40-expired caches — relays that don't honour expiration
    // keep serving them, so the client filters them out here.
    const nowSec = Date.now() / 1000;
    items = items.filter(({ cache }) => cache.expiresAt === null || cache.expiresAt > nowSec);
    // Restrict to caches whose decoded position is inside the
    // mini-map's visible bbox. As the user zooms out the bbox grows
    // and more caches surface; no chip-row to set "within X km".
    if (mapBbox) {
      items = items.filter(({ cache }) => {
        if (!cache.geohash) return false;
        const c = decodeGeohash(cache.geohash);
        return (
          c.lat >= mapBbox.minLat &&
          c.lat <= mapBbox.maxLat &&
          c.lng >= mapBbox.minLon &&
          c.lng <= mapBbox.maxLon
        );
      });
    }
    if (selectedDifficulties.size > 0) {
      // A cache with no difficulty tag is treated as "1" — typical
      // hider convention for a trivial walk-up; otherwise filtering
      // would silently drop legitimate easy caches.
      items = items.filter(({ cache }) => selectedDifficulties.has(cache.difficulty ?? 1));
    }
    if (selectedTerrains.size > 0) {
      items = items.filter(({ cache }) => selectedTerrains.has(cache.terrain ?? 1));
    }
    if (selectedTypes.size > 0) {
      items = items.filter(({ cache }) =>
        cache.cacheType ? selectedTypes.has(cache.cacheType) : false,
      );
    }
    // Web-of-trust filter — drop caches from hiders outside the active
    // tier's trust graph. `isTrusted` short-circuits to true for 'all'.
    items = items.filter(({ cache }) => isTrusted(cache.hiderPubkey));
    return items;
  }, [caches, pos, mapBbox, selectedDifficulties, selectedTerrains, selectedTypes, isTrusted]);

  const activeFilterCount = useMemo(
    () =>
      countActiveFilters({
        selectedDifficulties,
        selectedTerrains,
        selectedTypes,
        wotTier,
      }),
    [selectedDifficulties, selectedTerrains, selectedTypes, wotTier],
  );

  const availableTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const c of caches.values()) if (c.cacheType) seen.add(c.cacheType);
    return [...seen].sort();
  }, [caches]);

  // Count of loaded caches the WoT filter is hiding — 0 for the 'all'
  // tier. Recomputes on tier change so the "n hidden" line stays
  // accurate without a re-subscribe.
  const wotHiddenCount = useMemo(
    () => [...caches.values()].filter((c) => !isTrusted(c.hiderPubkey)).length,
    [caches, isTrusted],
  );

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
        <Image
          source={require('../../assets/images/learn-header-bg.png')}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <View style={styles.headerOverlay} />
        <View style={styles.headerRow}>
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
            onPress={() => navigation.navigate('MyPiglets')}
            accessibilityLabel="My Piglets"
            testID="hunt-my-piglets-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <PiggyBank size={22} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTagline}>Hunt for sats hidden in the wild</Text>
      </View>

      {/* Inline interactive map — lives OUTSIDE the FlatList rather
          than as ListHeaderComponent so a vertical pan on the map
          never reaches the FlatList's RefreshControl. The earlier
          `scrollEnabled={!mapTouched}` toggle had a state-update race
          that let the FlatList capture the gesture before mapTouched
          flipped, accidentally firing pull-to-refresh when the user
          tried to pan the map down. Trade-off: the map no longer
          scrolls out of view as the user scrolls the list — but that
          matches the typical map+list pattern (Uber, Citymapper, etc.).
          The list below filters by WoT + difficulty/terrain/type +
          search; passing `filteredCaches` so the map matches the list
          visually (#19). */}
      <View style={styles.mapWrap}>
        <LibreMiniMap
          // Mini-map follows GPS — camera anchor should track live
          // position, not the stale one-shot fetch `pos`.
          lat={livePos?.lat ?? pos?.lat ?? null}
          lon={livePos?.lon ?? pos?.lon ?? null}
          userLat={livePos?.lat ?? null}
          userLon={livePos?.lon ?? null}
          userAvatarUri={profile?.picture ?? null}
          // Only fall back to the initial-fetch accuracy when there's
          // no live fix yet; once livePos exists, trust its accuracy
          // (including null) so we never render a halo around live
          // coords with stale accuracy.
          userAccuracyMetres={livePos ? livePos.accuracy : (pos?.accuracy ?? null)}
          merchants={[]}
          caches={filteredCaches.map((c) => c.cache)}
          events={[]}
          onTapMap={() => navigation.navigate('Map')}
          onSelectCache={(c) => setSelectedCache(c)}
          onOpenLegend={() => setLegendVisible(true)}
          // One zoom level wider than the default 13 so the Geo-caches
          // hub map shows a bigger catchment without the user having to
          // pinch-zoom out.
          defaultZoom={12}
        />
      </View>

      <FlatList
        data={filteredCaches}
        keyExtractor={({ cache }) => cache.coord}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brandPink}
            colors={[colors.brandPink]}
          />
        }
        ListHeaderComponent={
          <View>
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
              <TouchableOpacity
                style={styles.filterIconButton}
                onPress={() => setFilterSheetOpen(true)}
                testID="hunt-filter-button"
                accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <SlidersHorizontal size={18} color={colors.textHeader} strokeWidth={2.5} />
                {activeFilterCount > 0 ? (
                  <View style={styles.filterIconBadge}>
                    <Text style={styles.filterIconBadgeText}>{activeFilterCount}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </View>
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
      <HuntFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        selectedDifficulties={selectedDifficulties}
        onChangeDifficulties={setSelectedDifficulties}
        selectedTerrains={selectedTerrains}
        onChangeTerrains={setSelectedTerrains}
        availableTypes={availableTypes}
        selectedTypes={selectedTypes}
        onChangeTypes={setSelectedTypes}
        wotUntrustedHidden={wotHiddenCount}
        onClearAll={() => {
          setSelectedDifficulties(new Set());
          setSelectedTerrains(new Set());
          setSelectedTypes(new Set());
          // WoT tier reset is intentionally not bundled here — the user
          // controls it via the bottom-sheet picker so "Clear all" stays
          // a filter-only action, not a safety-affecting one.
        }}
      />
      {/* Map-legend sheet — no merchants on the Geo-caches surface, so
          the categories section is suppressed and the sheet just lists
          the Piglet / NIP-GC cache / user pin types. */}
      <LegendSheet
        visible={legendVisible}
        onClose={() => setLegendVisible(false)}
        placesVisible={false}
        availableCategories={[]}
      />
      {/* Mini-map pin-tap sheet — same component MapScreen +
          ExploreHomeScreen use so the interaction shape is identical
          across every map surface. PR #630 follow-up. */}
      {selectedCache && (
        <CacheDetailSheet
          cache={selectedCache}
          colors={colors}
          onClose={() => setSelectedCache(null)}
          onViewDetails={() => {
            const coord = selectedCache.coord;
            setSelectedCache(null);
            navigation.navigate('HuntPiggyDetail', { coord });
          }}
        />
      )}
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
    <View style={styles.iconContainer}>
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
      <LpPayoutBadge isLpPiggy={cache.isLpPiggy} payoutSats={cache.payoutSats} />
    </View>
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
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 14,
      backgroundColor: colors.brandPink,
      minHeight: 140,
      overflow: 'hidden',
    },
    headerImage: {
      ...StyleSheet.absoluteFillObject,
    },
    headerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(236, 0, 140, 0.65)',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerTagline: {
      marginTop: 10,
      paddingHorizontal: 4,
      color: 'rgba(255,255,255,0.85)',
      fontSize: 13,
      fontWeight: '500',
    },
    mapWrap: {
      // 16dp header-to-map gap — kept in sync with ExploreHome's
      // `scrollContent.paddingTop` and PlacesScreen's `listContent`
      // top padding so the three Explore-stack screens match.
      marginTop: 16,
      // 10 dp below the map = same gap between search and rows below =
      // same gap between rows. Three identical vertical rhythms so the
      // page reads as a tidy stack rather than three different spacings.
      marginBottom: 10,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 10,
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
    filterIconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    filterIconBadge: {
      position: 'absolute',
      top: -2,
      right: -2,
      minWidth: 16,
      height: 16,
      paddingHorizontal: 4,
      borderRadius: 8,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterIconBadgeText: {
      color: colors.white,
      fontSize: 10,
      fontWeight: '800',
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
    // Brand violet for NIP-GC caches — matches the new map pin (and
    // every other surface). Was textSupplementary (slate) which read
    // as "muted/disabled" and clashed with the now-coloured map pin.
    iconStandard: { backgroundColor: '#7A5CFF' },
    iconContainer: { position: 'relative' },
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
