import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
} from 'react-native';
import * as Location from 'expo-location';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPinned,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react-native';
import Toast from '../components/BrandedToast';
import EventsFilterSheet, {
  countActiveFilters,
  type EventsSortKey,
} from '../components/EventsFilterSheet';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import {
  decodeGeohash,
  encodeGeohash,
  formatDistance,
  geohashPrefixes,
  haversineMetres,
} from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { type ParsedEvent } from '../services/nostrPlacesService';
import { subscribeNearbyEvents } from '../services/nostrPlacesPublisher';
import { loadCachedEvents, peekCachedEventsSync, saveEvents } from '../services/nostrPlacesStorage';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Events sub-screen — read-only feed of NIP-52 kind 31923 calendar
 * events with a `g` tag inside the user's coarse geohash neighbourhood
 * (5-char prefix ≈ 5 km). Bitcoin meetups, conferences, etc. that
 * organisers publish via Flockstr / Coracle / similar clients show up
 * here. Tap a row to expand the inline detail; tap the location to
 * open in OS maps.
 *
 * Replaces the M1 "Coming soon" stub. Closes M7 of the Explore plan.
 */
const EventsScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [events, setEvents] = useState<Map<string, ParsedEvent>>(
    () => new Map(peekCachedEventsSync().map((e) => [e.coord, e])),
  );

  // Hydrate from AsyncStorage so the list paints instantly on cold
  // start while the live relay sub backfills.
  useEffect(() => {
    let cancelled = false;
    loadCachedEvents().then((es) => {
      if (cancelled || es.length === 0) return;
      setEvents((prev) => {
        if (prev.size > 0) return prev;
        const m = new Map<string, ParsedEvent>();
        for (const e of es) m.set(e.coord, e);
        return m;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (events.size === 0) return;
    const t = setTimeout(() => saveEvents([...events.values()]), 1500);
    return () => clearTimeout(t);
  }, [events]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCoord, setExpandedCoord] = useState<string | null>(null);
  const [untrustedHidden, setUntrustedHidden] = useState(0);
  // User position is captured so each row can compute "X away" via
  // haversine + the list sort prefers proximity (with start-time as
  // tiebreaker for events at the same geohash).
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  // Free-text search over title / description / location / hashtags.
  // Pure client-side filter against the already-trust-filtered list;
  // no extra relay queries.
  const [searchQuery, setSearchQuery] = useState('');
  // Optional distance ceiling. `null` = no filter (default — show all
  // events in the user's web of trust regardless of distance).
  // Numeric value = haversine cap in metres.
  const [maxDistanceMetres, setMaxDistanceMetres] = useState<number | null>(null);
  // Date-range ceiling expressed as seconds-from-now. `null` = no filter
  // (default). Picked from a chip row so users can narrow the feed to
  // "this week" / "this month" without committing to a calendar picker.
  const [maxFromNowSec, setMaxFromNowSec] = useState<number | null>(null);
  // Sort key — 'date' (chronological, default) or 'distance' (nearest
  // first). Persisted via the filter sheet so users keep their pick.
  const [sortBy, setSortBy] = useState<EventsSortKey>('date');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const closerRef = useRef<(() => void) | null>(null);

  // Post-#535: `wotTier` replaces the legacy `filterEnabled` boolean.
  // `isTrusted` is tier-aware (returns true for 'all') so callers no
  // longer need to gate on a separate "enabled" flag.
  const { isTrusted, wotTier } = useTrustGraph();
  const isTrustedRef = useRef(isTrusted);
  useEffect(() => {
    isTrustedRef.current = isTrusted;
  }, [isTrusted]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEvents(new Map());
    setUntrustedHidden(0);
    closerRef.current?.();
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
            'Location permission required to discover nearby events. We use a coarse 5 km area, not your exact location.',
          );
          setLoading(false);
          return;
        }
        const liveFix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lat = liveFix.coords.latitude;
        lon = liveFix.coords.longitude;
      }
      setPos({ lat, lon });
      const myGh = encodeGeohash(lat, lon, 7);
      // Precision 3 (~150 km neighbourhood) — Bitcoin meetups cluster
      // in cities; rural users would otherwise see an empty feed.
      // NIP-52 publishers conventionally emit g tags at every
      // precision 3..9, so 3-char prefix is enough to catch them.
      const prefixes = geohashPrefixes(myGh, 3).filter((p) => p.length === 3);
      const closer = subscribeNearbyEvents(prefixes, (e) => {
        // De-dupe by coord — replaceable events; only keep the
        // newest revision and skip past events.
        if (e.startsAt && e.startsAt < Math.floor(Date.now() / 1000) - 60 * 60) {
          return;
        }
        // WoT filter — see `trustGraphService` for the threat model.
        // `isTrusted` is tier-aware post-#535 (returns true for 'all').
        if (!isTrustedRef.current(e.organiserPubkey)) {
          setUntrustedHidden((n) => n + 1);
          return;
        }
        setEvents((prev) => {
          const existing = prev.get(e.coord);
          if (existing && existing.startsAt === e.startsAt) return prev;
          const next = new Map(prev);
          next.set(e.coord, e);
          return next;
        });
      });
      closerRef.current = closer;
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

  const sortedEvents = useMemo(() => {
    // Each row carries its precomputed distance so the badge text
    // doesn't re-haversine on every paint. Primary sort key is chosen
    // by the user (sortBy = 'date' | 'distance'); the other key is the
    // tiebreaker so a 0-distance pair never randomly flips order between
    // renders.
    const items = [...events.values()].map((event) => {
      const center = event.geohash ? decodeGeohash(event.geohash) : null;
      const distance =
        pos && center
          ? haversineMetres({ lat: pos.lat, lon: pos.lon }, { lat: center.lat, lon: center.lng })
          : Number.POSITIVE_INFINITY;
      return { event, distance };
    });
    items.sort((a, b) => {
      const startA = a.event.startsAt ?? Number.MAX_SAFE_INTEGER;
      const startB = b.event.startsAt ?? Number.MAX_SAFE_INTEGER;
      if (sortBy === 'distance') {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return startA - startB;
      }
      // sortBy === 'date'
      if (startA !== startB) return startA - startB;
      return a.distance - b.distance;
    });
    return items;
  }, [events, pos, sortBy]);

  // Filtered slice — search query (substring match) AND optional
  // distance ceiling. Both default to "no filter" so a fresh user
  // sees every WoT-trusted event regardless of how far away it is.
  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let items = sortedEvents;
    if (maxDistanceMetres !== null) {
      items = items.filter(({ distance }) => distance <= maxDistanceMetres);
    }
    if (maxFromNowSec !== null) {
      const nowSec = Math.floor(Date.now() / 1000);
      const ceiling = nowSec + maxFromNowSec;
      items = items.filter(({ event }) => event.startsAt !== null && event.startsAt <= ceiling);
    }
    if (q) {
      items = items.filter(({ event }) => {
        const hay = [event.title, event.description, event.location ?? '', event.hashtags.join(' ')]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return items;
  }, [sortedEvents, searchQuery, maxDistanceMetres, maxFromNowSec]);

  const activeFilterCount = useMemo(
    () =>
      countActiveFilters({
        maxDistanceMetres,
        maxFromNowSec,
        wotTier,
      }),
    [maxDistanceMetres, maxFromNowSec, wotTier],
  );

  const onCreateEvent = useCallback(() => {
    // Full create flow lives behind a Nostr signer + venue picker we
    // haven't built yet. Surface a friendly placeholder so the
    // affordance is discoverable and the door is propped open.
    Toast.show({
      type: 'info',
      text1: 'Creating events lands soon',
      text2:
        'For now publish your meetup via Flockstr or Coracle — it shows up here automatically.',
      visibilityTime: 5000,
    });
  }, []);

  const openInMaps = useCallback((event: ParsedEvent) => {
    const q = event.location ?? (event.geohash ? event.geohash : event.title);
    const encoded = encodeURIComponent(q);
    // Geo URI is honoured by Android's intent system + iOS Maps.
    Linking.openURL(`geo:0,0?q=${encoded}`).catch(() => {
      Linking.openURL(`https://www.openstreetmap.org/search?query=${encoded}`).catch(() => {});
    });
  }, []);

  return (
    <View style={styles.container} testID="events-screen">
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
            testID="events-back-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Events</Text>
          <TouchableOpacity
            onPress={onCreateEvent}
            accessibilityLabel="Create event"
            testID="events-create-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Plus size={20} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTagline}>Bitcoin meetups and gatherings near you</Text>
      </View>

      {/* Search bar — filters the loaded events client-side. Cheap, no
          extra relay queries. Distance / Date / WoT live in the filter
          sheet behind the slider icon. */}
      <View style={styles.searchRow}>
        <Search size={16} color={colors.textSupplementary} strokeWidth={2.5} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search events…"
          placeholderTextColor={colors.textSupplementary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
          testID="events-search-input"
        />
        <TouchableOpacity
          style={styles.filterIconButton}
          onPress={() => setFilterSheetOpen(true)}
          testID="events-filter-button"
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

      {loading && events.size === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPink} />
          <Text style={styles.subtle}>Looking for Bitcoin events near you…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={reload}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : sortedEvents.length === 0 ? (
        <View style={styles.center} testID="events-empty-state">
          <CalendarDays size={56} color={colors.textSupplementary} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No upcoming events nearby</Text>
          <Text style={styles.subtle}>
            Bitcoin meetups, conferences and similar gatherings published as NIP-52 calendar events
            show up here. Try widening your search by travelling — or organise one!
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            refreshControl={
              <RefreshControl
                refreshing={loading && events.size > 0}
                onRefresh={reload}
                tintColor={colors.brandPink}
                colors={[colors.brandPink]}
              />
            }
            // Hero card lives in the list header so it scrolls with the
            // rest. Showing a large image + description for the very
            // next event helps users orient at a glance; hidden when the
            // user is searching (the hero would look stale).
            data={
              searchQuery.trim() === '' && filteredEvents.length > 0
                ? filteredEvents.slice(1)
                : filteredEvents
            }
            ListHeaderComponent={
              searchQuery.trim() === '' && filteredEvents.length > 0 ? (
                <EventHero
                  event={filteredEvents[0].event}
                  distance={filteredEvents[0].distance}
                  onPress={() =>
                    navigation.navigate('EventDetail', {
                      coord: filteredEvents[0].event.coord,
                    })
                  }
                  expanded={false}
                  onOpenInMaps={() => openInMaps(filteredEvents[0].event)}
                  colors={colors}
                  styles={styles}
                />
              ) : null
            }
            keyExtractor={({ event }) => event.coord}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
              <EventRow
                event={item.event}
                distance={item.distance}
                // Highlight the first two unsearched rows as "Up next"
                // (hero already pulls the very-next one out). When the
                // user is searching the highlight makes no sense.
                upNext={searchQuery.trim() === '' && index < 2}
                expanded={false}
                onToggle={() => navigation.navigate('EventDetail', { coord: item.event.coord })}
                onOpenInMaps={() => openInMaps(item.event)}
                colors={colors}
                styles={styles}
              />
            )}
            ListEmptyComponent={
              searchQuery.trim() !== '' ? (
                <Text style={styles.emptySearchText}>
                  Nothing matches “{searchQuery.trim()}”. Try a city, hashtag, or organiser name.
                </Text>
              ) : null
            }
          />
        </>
      )}
      <EventsFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        maxDistanceMetres={maxDistanceMetres}
        onChangeMaxDistance={setMaxDistanceMetres}
        maxFromNowSec={maxFromNowSec}
        onChangeMaxFromNow={setMaxFromNowSec}
        wotUntrustedHidden={untrustedHidden}
        sortBy={sortBy}
        onChangeSortBy={setSortBy}
        onClearAll={() => {
          setMaxDistanceMetres(null);
          setMaxFromNowSec(null);
          setSortBy('date');
          // WoT tier reset is intentionally not bundled here — the user
          // controls it via the bottom-sheet picker.
        }}
      />
    </View>
  );
};

const formatDate = (ts: number | null): string => {
  if (!ts) return 'Time TBA';
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const dayLabel = (ts: number | null): { day: string; month: string } => {
  if (!ts) return { day: '?', month: '—' };
  const d = new Date(ts * 1000);
  return {
    day: String(d.getDate()),
    month: d.toLocaleString(undefined, { month: 'short' }).toUpperCase(),
  };
};

const EventHero: React.FC<{
  event: ParsedEvent;
  distance: number;
  expanded: boolean;
  onPress: () => void;
  onOpenInMaps: () => void;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ event, distance, expanded, onPress, onOpenInMaps, colors, styles }) => (
  <TouchableOpacity
    style={styles.heroCard}
    onPress={onPress}
    activeOpacity={0.85}
    testID={`event-hero-${event.d}`}
    accessibilityLabel={`Next event: ${event.title}`}
  >
    {event.imageUrl ? (
      <Image source={{ uri: event.imageUrl }} style={styles.heroImage} resizeMode="cover" />
    ) : (
      <View style={[styles.heroImage, styles.heroImageFallback]}>
        <CalendarDays size={48} color={colors.brandPink} strokeWidth={1.5} />
      </View>
    )}
    <View style={styles.heroBody}>
      <Text style={styles.heroUpNext}>UP NEXT</Text>
      <Text style={styles.heroTitle} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.heroMeta} numberOfLines={2}>
        {formatDate(event.startsAt)}
        {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
        {event.location ? ` · ${event.location}` : ''}
      </Text>
      {event.description ? (
        <Text style={styles.heroDescription} numberOfLines={expanded ? 0 : 3}>
          {event.description}
        </Text>
      ) : null}
      {expanded && (event.location || event.geohash) ? (
        <TouchableOpacity
          style={styles.locationButton}
          onPress={onOpenInMaps}
          testID={`event-hero-${event.d}-open-in-maps`}
        >
          <MapPinned size={14} color={colors.brandPink} strokeWidth={2.5} />
          <Text style={styles.locationButtonText}>Open in Maps</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  </TouchableOpacity>
);

const EventRow: React.FC<{
  event: ParsedEvent;
  distance: number;
  upNext: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpenInMaps: () => void;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ event, distance, upNext, expanded, onToggle, onOpenInMaps, colors, styles }) => {
  const { day, month } = dayLabel(event.startsAt);
  return (
    <TouchableOpacity
      style={[styles.row, upNext ? styles.rowUpNext : null]}
      onPress={onToggle}
      testID={`event-row-${event.d}`}
      accessibilityLabel={event.title}
    >
      {upNext ? <Text style={styles.upNextChip}>UP NEXT</Text> : null}
      <View style={styles.dateBlock}>
        <Text style={styles.dateMonth}>{month}</Text>
        <Text style={styles.dateDay}>{day}</Text>
      </View>
      {/* Thumbnail in the collapsed row so the user can recognise the
          event at a glance. Falls back to nothing (date block + meta
          carry the row on their own) when the publisher didn't supply
          an image. The expanded view renders a wider hero image too. */}
      {event.imageUrl ? (
        <Image source={{ uri: event.imageUrl }} style={styles.thumb} resizeMode="cover" />
      ) : null}
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={expanded ? 0 : 1}>
          {event.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {formatDate(event.startsAt)}
          {event.location ? ` · ${event.location}` : ''}
        </Text>
        {/* Distance gets its own line so it's never truncated by a long
            venue address; events without a geohash render an em-dash so
            the layout stays consistent row-to-row. */}
        <Text style={styles.rowDistance} numberOfLines={1}>
          {Number.isFinite(distance) ? formatDistance(distance) : '— distance unknown'}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.textSupplementary} strokeWidth={2.5} />
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    subtle: { fontSize: 14, color: colors.textSupplementary, textAlign: 'center', lineHeight: 20 },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 6,
      textAlign: 'center',
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
    listContent: { padding: 16 },
    row: {
      flexDirection: 'row',
      gap: 14,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    dateBlock: {
      width: 56,
      paddingVertical: 6,
      backgroundColor: colors.brandPinkLight,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateMonth: { color: colors.brandPink, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
    dateDay: { color: colors.brandPink, fontSize: 22, fontWeight: '800', marginTop: 2 },
    thumb: {
      width: 56,
      height: 56,
      borderRadius: 10,
      backgroundColor: colors.divider,
    },
    rowUpNext: {
      borderLeftWidth: 3,
      borderLeftColor: colors.brandPink,
      paddingLeft: 9, // 12 - 3 to keep contents aligned with non-UpNext rows
    },
    upNextChip: {
      position: 'absolute',
      top: 8,
      right: 10,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.brandPink,
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
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.textHeader,
      paddingVertical: 4,
    },
    emptySearchText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      padding: 24,
    },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '700', color: colors.textHeader },
    rowMeta: { fontSize: 12, color: colors.textSupplementary, marginTop: 2 },
    rowDistance: {
      fontSize: 12,
      color: colors.brandPink,
      marginTop: 2,
      fontWeight: '600',
    },
    expanded: { marginTop: 10, gap: 10 },
    expandedImage: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 10,
      backgroundColor: colors.divider,
    },
    expandedDescription: { fontSize: 13, color: colors.textHeader, lineHeight: 19 },
    expandedHashtags: { fontSize: 12, color: colors.textSupplementary },
    locationButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brandPinkLight,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 100,
      alignSelf: 'flex-start',
    },
    locationButtonText: { color: colors.brandPink, fontSize: 13, fontWeight: '700' },
    heroCard: {
      // No marginHorizontal — listContent already applies padding: 16,
      // so the hero aligns flush with the rows below it.
      marginTop: 8,
      marginBottom: 12,
      borderRadius: 14,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    heroImage: {
      width: '100%',
      height: 180,
      backgroundColor: colors.background,
    },
    heroImageFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroBody: {
      padding: 14,
      gap: 6,
    },
    heroUpNext: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.brandPink,
    },
    heroTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textHeader,
      lineHeight: 22,
    },
    heroMeta: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
    heroDescription: {
      fontSize: 13,
      color: colors.textBody,
      lineHeight: 19,
      marginTop: 4,
    },
  });

export default EventsScreen;
