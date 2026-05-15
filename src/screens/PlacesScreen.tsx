import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Linking,
  RefreshControl,
  Image,
} from 'react-native';
import * as Location from 'expo-location';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import {
  type BtcMapPlace,
  acceptsLightning,
  acceptsOnchain,
  fetchPlacesInBbox,
  getCachedPlaces,
  formatAddress,
  isBoosted,
  lightningAddressOf,
} from '../services/btcMapService';
import { formatDistance, haversineMetres } from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import BtcMapAttribution from '../components/BtcMapAttribution';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import PlacesFilterSheet, { countActiveFilters } from '../components/PlacesFilterSheet';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Places sub-screen — list of nearby Bitcoin-accepting merchants
 * sourced from BTC Map / OSM, sorted by distance from the user.
 * Tap a row to open `PlaceDetail` for the full address, payment
 * methods, contact info and a Pay-via-Lightning button. The
 * `See all →` link on the Hub's "Places near you" rail routes here
 * instead of jumping straight to the full map — most users want a
 * list view first; the map is one tap away from the header.
 *
 * Implementation mirrors `EventsScreen` / `HuntDiscoverScreen`:
 *   - pos captured up front so distance + sort work
 *   - client-side search box for substring match
 *   - "Open map" button in the header for users who want the visual
 */
const PlacesScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mapBbox, setMapBbox] = useState<{
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  } | null>(null);
  const [places, setPlaces] = useState<BtcMapPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const lastReloadRef = useRef<number>(0);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Stale-while-revalidate: paint the last cached result instantly so
      // the list isn't a blank spinner while GPS + the live search resolve.
      getCachedPlaces()
        .then((cached) => {
          if (cached.length > 0) setPlaces((prev) => (prev.length > 0 ? prev : cached));
        })
        .catch(() => {});
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
            'Location permission required to show nearby Bitcoin-accepting places. We use a coarse area, not your exact position.',
          );
          setLoading(false);
          return;
        }
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lat = fix.coords.latitude;
        lon = fix.coords.longitude;
      }
      setPos({ lat, lon });
      // ±2° (~220 km half-side) — wider than the on-screen mini-map's
      // min-zoom bbox so the user can zoom out and still see merchants.
      // The BTC Map dataset is already fully in memory; bbox filtering
      // is an O(28k) in-memory walk, so a wider window costs nothing.
      // Earlier ±0.5° (~55 km) capped the on-screen list at ~38 km no
      // matter how far the user zoomed out — felt like a load bug.
      const list = await fetchPlacesInBbox({
        minLon: lon - 2,
        minLat: lat - 2,
        maxLon: lon + 2,
        maxLat: lat + 2,
      });
      setPlaces(list);
      lastReloadRef.current = Date.now();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const sortedPlaces = useMemo(() => {
    if (!pos) return [] as { place: BtcMapPlace; distance: number }[];
    return (
      places
        .map((place) => ({
          place,
          distance: haversineMetres(
            { lat: pos.lat, lon: pos.lon },
            { lat: place.lat, lon: place.lon },
          ),
        }))
        // Boosted listings surface first (BTC Map's paid-feature
        // mechanism); within the same boost bucket we still sort by
        // distance. Every boosted row carries a "Featured" pill so the
        // user can see why it's at the top.
        .sort((a, b) => {
          const ab = isBoosted(a.place) ? 1 : 0;
          const bb = isBoosted(b.place) ? 1 : 0;
          if (ab !== bb) return bb - ab;
          return a.distance - b.distance;
        })
    );
  }, [places, pos]);

  // Selected category filters — empty = show every category (default).
  // Categories are surfaced in the filter bottom-sheet; selected names
  // compose with `searchQuery` (AND), but OR within the set so the list
  // doesn't filter to zero (most listings carry 0-2 categories).
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // Mirrors ExploreMiniMap's onInteractionChange. While truthy we
  // freeze the FlatList's scrolling so vertical taps + drags on the
  // inline map don't accidentally trigger pull-to-refresh.
  const [mapTouched, setMapTouched] = useState(false);
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const p of places) for (const c of p.categories ?? []) seen.add(c);
    return [...seen].sort();
  }, [places]);
  const activeFilterCount = useMemo(
    () => countActiveFilters({ selectedCategories }),
    [selectedCategories],
  );

  const filteredPlaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let items = sortedPlaces;
    if (mapBbox) {
      items = items.filter(
        ({ place }) =>
          place.lat >= mapBbox.minLat &&
          place.lat <= mapBbox.maxLat &&
          place.lon >= mapBbox.minLon &&
          place.lon <= mapBbox.maxLon,
      );
    }
    if (selectedCategories.size > 0) {
      items = items.filter(({ place }) =>
        (place.categories ?? []).some((c) => selectedCategories.has(c)),
      );
    }
    if (!q) return items;
    return items.filter(({ place }) => {
      const hay = [
        place.tags.name ?? '',
        place.tags['addr:street'] ?? '',
        place.tags['addr:city'] ?? '',
        place.tags['addr:postcode'] ?? '',
        // Free-text search now also matches the curated category names
        // and the OSM cuisine tag, so "italian" / "cafe" / "bicycle"
        // resolve listings even when the user doesn't tap a chip.
        ...(place.categories ?? []),
        place.tags['cuisine'] ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedPlaces, searchQuery, selectedCategories, mapBbox]);

  return (
    <View style={styles.container} testID="places-screen">
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
            testID="places-back-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Places</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Map')}
            accessibilityLabel="Open map view"
            testID="places-map-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MapPin size={20} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTagline}>Bitcoin-accepting merchants from BTC Map</Text>
      </View>

      <FlatList
        data={
          loading && places.length === 0
            ? []
            : error
              ? []
              : sortedPlaces.length === 0
                ? []
                : filteredPlaces
        }
        keyExtractor={({ place }) => String(place.id)}
        contentContainerStyle={styles.listContent}
        scrollEnabled={!mapTouched}
        refreshControl={
          <RefreshControl
            refreshing={loading && places.length > 0}
            onRefresh={reload}
            tintColor={colors.brandPink}
            colors={[colors.brandPink]}
          />
        }
        ListHeaderComponent={
          <>
            <View style={styles.miniMapContainer}>
              <ExploreMiniMap
                lat={pos?.lat ?? null}
                lon={pos?.lon ?? null}
                merchants={sortedPlaces.map((p) => p.place)}
                caches={[]}
                events={[]}
                loading={loading && sortedPlaces.length === 0}
                onTapMap={() => navigation.navigate('Map')}
                onBoundsChange={setMapBbox}
                onInteractionChange={setMapTouched}
                defaultZoom={10}
              />
            </View>
            <View style={styles.attributionRow}>
              <BtcMapAttribution testID="places-btcmap-attribution" />
            </View>
            <View style={styles.searchRow}>
              <Search size={16} color={colors.textSupplementary} strokeWidth={2.5} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search places by name or address…"
                placeholderTextColor={colors.textSupplementary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                testID="places-search-input"
              />
              <TouchableOpacity
                style={styles.filterIconButton}
                onPress={() => setFilterSheetOpen(true)}
                testID="places-filter-button"
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
            {loading && places.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.brandPink} />
                <Text style={styles.subtle}>Looking for Bitcoin-accepting places near you…</Text>
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={reload}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : sortedPlaces.length === 0 ? (
              <View style={styles.center} testID="places-empty-state">
                <MapPin size={56} color={colors.textSupplementary} strokeWidth={1.5} />
                <Text style={styles.emptyTitle}>No places nearby</Text>
                <Text style={styles.subtle}>
                  We searched a ~50 km area. Try opening the full map to pan further afield, or
                  refresh later — the OSM merchant list updates daily.
                </Text>
              </View>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <PlaceRow
            place={item.place}
            distance={item.distance}
            colors={colors}
            styles={styles}
            onPress={() => navigation.navigate('PlaceDetail', { placeId: item.place.id })}
          />
        )}
        ListEmptyComponent={
          searchQuery.trim() !== '' && sortedPlaces.length > 0 ? (
            <Text style={styles.emptySearchText}>
              Nothing matches “{searchQuery.trim()}”. Try a city or street name.
            </Text>
          ) : null
        }
      />
      <PlacesFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        availableCategories={availableCategories}
        selectedCategories={selectedCategories}
        onChangeCategories={setSelectedCategories}
        onClearAll={() => setSelectedCategories(new Set())}
      />
    </View>
  );
};

const PlaceRow: React.FC<{
  place: BtcMapPlace;
  distance: number;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}> = ({ place, distance, colors, styles, onPress }) => {
  const lightning = acceptsLightning(place);
  const onchain = acceptsOnchain(place);
  const lud16 = lightningAddressOf(place);
  const boosted = isBoosted(place);
  const website = place.tags['contact:website'];
  const websiteLabel = website ? website.replace(/^https?:\/\/(www\.)?/i, '') : null;
  return (
    <TouchableOpacity
      style={[styles.row, boosted ? styles.rowBoosted : null]}
      onPress={onPress}
      testID={`place-row-${place.id}`}
      accessibilityLabel={place.tags.name ?? 'Unnamed merchant'}
    >
      <View style={[styles.iconWrap, lightning ? styles.iconLightning : styles.iconOnchain]}>
        {/* Category icon (Coffee / UtensilsCrossed / Hotel / …) tells
            the user WHAT the place is at a glance. The pink / orange
            background still distinguishes Lightning vs on-chain
            payment — same idiom as MerchantDetailSheet, so list rows
            + the detail sheet read consistently. */}
        {(() => {
          const CategoryIcon = btcMapIconComponent(place.icon);
          return <CategoryIcon size={22} color={colors.white} strokeWidth={2.5} />;
        })()}
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {place.tags.name ?? 'Unnamed merchant'}
          </Text>
          {boosted ? (
            <View style={styles.rowFeaturedPill}>
              <Sparkles size={10} color={colors.textHeader} strokeWidth={2.5} />
              <Text style={styles.rowFeaturedText}>Featured</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {lightning ? '⚡ Lightning' : onchain ? 'On-chain' : 'Bitcoin'}
          {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
          {lud16 ? ` · ${lud16}` : ''}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {formatAddress(place)}
        </Text>
        {website && websiteLabel ? (
          <TouchableOpacity
            onPress={() => {
              Linking.openURL(website).catch(() => {});
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            testID={`place-row-${place.id}-website`}
            accessibilityLabel={`Open website ${websiteLabel}`}
          >
            <Text style={styles.rowLink} numberOfLines={1}>
              {websiteLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <ChevronRight size={20} color={colors.textSupplementary} />
    </TouchableOpacity>
  );
};

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
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    attributionRow: {
      // Cancel the `listContent` 16px padding then re-apply 16px so the
      // chip's right edge lines up with the map's right edge (the map
      // sits at a true 16dp inset — see `miniMapContainer`).
      marginHorizontal: -16,
      paddingHorizontal: 16,
      // Negative top margin pulls the chip up into the small gap below
      // the map so it visually sits glued to the map's bottom edge.
      // Bottom padding keeps breathing room before the search row.
      marginTop: -4,
      paddingTop: 0,
      paddingBottom: 12,
      alignItems: 'flex-end',
    },
    miniMapContainer: {
      // `listContent` applies `padding: 16`, and `ExploreMiniMap` already
      // carries its own `marginHorizontal: 16`. Without cancelling the
      // list padding the map ends up double-inset (~32dp) and visibly
      // narrower than the Geo-caches map (which only gets the 16dp).
      // Negative horizontal margin cancels the list padding so the map
      // lands at a true 16dp inset, consistent across the Explore stack.
      marginHorizontal: -16,
      // No extra paddingTop — `listContent`'s own `padding: 16` already
      // gives the 16dp header-to-map gap shared across Explore / Places
      // / Geo-caches. The old `paddingTop: 12` stacked on top of that
      // (28dp total) and made this screen's gap inconsistent.
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.textHeader,
      paddingVertical: 4,
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
    emptySearchText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      padding: 24,
    },
    errorText: { fontSize: 14, color: colors.brandPink, textAlign: 'center', lineHeight: 20 },
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
    rowBoosted: {
      // 1px zap-yellow border + a hint of fill so a boosted row stands
      // apart from the surface stack without screaming.
      borderWidth: 1,
      borderColor: colors.zapYellow,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconLightning: { backgroundColor: colors.brandPink },
    iconOnchain: { backgroundColor: '#F7931A' },
    rowMain: { flex: 1 },
    rowTitleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rowTitle: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.textHeader },
    rowFeaturedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.zapYellow,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 999,
    },
    rowFeaturedText: { fontSize: 10, fontWeight: '800', color: colors.textHeader },
    rowMeta: { fontSize: 12, color: colors.textSupplementary, marginTop: 2 },
    rowSub: { fontSize: 12, color: colors.textSupplementary, marginTop: 2, fontStyle: 'italic' },
    rowLink: {
      fontSize: 12,
      color: colors.brandPink,
      marginTop: 2,
      fontStyle: 'italic',
      textDecorationLine: 'underline',
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
  });

export default PlacesScreen;
