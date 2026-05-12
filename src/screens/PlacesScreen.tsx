import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  RefreshCw,
  Search,
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
  formatAddress,
  isBoosted,
  lightningAddressOf,
} from '../services/btcMapService';
import { formatDistance, haversineMetres } from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';
import BtcMapAttribution from '../components/BtcMapAttribution';
import { ExploreMiniMap } from '../components/ExploreMiniMap';

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
      // Wide bbox (~50 km half-side) so rural users see drive-away
      // merchants too. Service caches in AsyncStorage with a 7-day
      // TTL — see `btcMapService`.
      const list = await fetchPlacesInBbox({
        minLon: lon - 0.5,
        minLat: lat - 0.5,
        maxLon: lon + 0.5,
        maxLat: lat + 0.5,
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
    return places
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
      });
  }, [places, pos]);

  // Selected category filters — empty = show every category (default).
  // Categories are surfaced as chip toggles above the list; selected
  // names compose with `searchQuery` (AND), not against each other (OR
  // within the set so the list doesn't filter to zero — most listings
  // carry 0-2 categories).
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const p of places) for (const c of p.categories ?? []) seen.add(c);
    return [...seen].sort();
  }, [places]);

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
        <TouchableOpacity
          onPress={reload}
          accessibilityLabel="Refresh"
          testID="places-refresh-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <RefreshCw size={20} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

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
      </View>

      {availableCategories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catChipsRow}
        >
          {availableCategories.map((cat) => {
            const on = selectedCategories.has(cat);
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.catChip, on ? styles.catChipOn : styles.catChipOff]}
                onPress={() => {
                  const next = new Set(selectedCategories);
                  if (next.has(cat)) next.delete(cat);
                  else next.add(cat);
                  setSelectedCategories(next);
                }}
                testID={`places-cat-${cat}`}
                accessibilityLabel={`${cat} category ${on ? 'on' : 'off'}`}
              >
                <Text style={[styles.catChipText, on ? styles.catChipTextOn : null]}>
                  {cat.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            );
          })}
          {selectedCategories.size > 0 ? (
            <TouchableOpacity
              style={styles.catChip}
              onPress={() => setSelectedCategories(new Set())}
              testID="places-cat-clear"
              accessibilityLabel="Clear category filter"
            >
              <Text style={[styles.catChipText, { color: colors.brandPink }]}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : null}

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
            We searched a ~50 km area. Try opening the full map to pan further afield, or refresh
            later — the OSM merchant list updates daily.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredPlaces}
          keyExtractor={({ place }) => String(place.id)}
          contentContainerStyle={styles.listContent}
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
            searchQuery.trim() !== '' ? (
              <Text style={styles.emptySearchText}>
                Nothing matches “{searchQuery.trim()}”. Try a city or street name.
              </Text>
            ) : null
          }
        />
      )}
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
  return (
    <TouchableOpacity
      style={[styles.row, boosted ? styles.rowBoosted : null]}
      onPress={onPress}
      testID={`place-row-${place.id}`}
      accessibilityLabel={place.tags.name ?? 'Unnamed merchant'}
    >
      <View style={[styles.iconWrap, lightning ? styles.iconLightning : styles.iconOnchain]}>
        {lightning ? (
          <Zap size={22} color={colors.white} strokeWidth={2.5} />
        ) : (
          <MapPin size={22} color={colors.white} strokeWidth={2.5} />
        )}
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
      </View>
      <ChevronRight size={20} color={colors.textSupplementary} />
    </TouchableOpacity>
  );
};

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
      paddingHorizontal: 16,
      // Tight under the map, with breathing room before the search row
      // so the chip reads as belonging to the map, not floating in
      // mid-air above the input.
      paddingTop: 2,
      paddingBottom: 12,
      alignItems: 'flex-end',
    },
    miniMapContainer: {
      // Edge-to-edge to match Hunt + Explore — no horizontal inset so
      // the three Explore-stack screens read as the same surface.
      paddingTop: 12,
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
    catChipsRow: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 8,
    },
    catChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      marginRight: 6,
    },
    catChipOff: {
      backgroundColor: 'transparent',
      borderColor: colors.divider,
    },
    catChipOn: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    catChipText: { fontSize: 12, color: colors.textHeader, fontWeight: '600', textTransform: 'capitalize' },
    catChipTextOn: { color: colors.white },
  });

export default PlacesScreen;
