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
} from 'react-native';
import * as Location from 'expo-location';
import { CalendarDays, ChevronLeft, MapPinned, Plus, RefreshCw, Search } from 'lucide-react-native';
import Toast from '../components/BrandedToast';
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
  const [events, setEvents] = useState<Map<string, ParsedEvent>>(new Map());
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
  const closerRef = useRef<(() => void) | null>(null);

  const { isTrusted, filterEnabled } = useTrustGraph();
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
        if (filterEnabled && !isTrustedRef.current(e.organiserPubkey)) {
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
    // Primary sort key: distance from user (nearest first). Falls
    // back to start time for events lacking a geohash. Each row
    // carries its precomputed distance so the badge text doesn't
    // re-haversine on every paint.
    const items = [...events.values()].map((event) => {
      const center = event.geohash ? decodeGeohash(event.geohash) : null;
      const distance =
        pos && center
          ? haversineMetres({ lat: pos.lat, lon: pos.lon }, { lat: center.lat, lon: center.lng })
          : Number.POSITIVE_INFINITY;
      return { event, distance };
    });
    items.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      const sa = a.event.startsAt ?? Number.MAX_SAFE_INTEGER;
      const sb = b.event.startsAt ?? Number.MAX_SAFE_INTEGER;
      return sa - sb;
    });
    return items;
  }, [events, pos]);

  // Filtered slice — case-insensitive substring match across the
  // fields a user would search by. Empty query → pass-through. Always
  // applied after sort so "next 3" highlighting (UpNext chip on the
  // first three entries) stays in distance-order.
  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedEvents;
    return sortedEvents.filter(({ event }) => {
      const hay = [event.title, event.description, event.location ?? '', event.hashtags.join(' ')]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedEvents, searchQuery]);

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
        <TouchableOpacity
          onPress={reload}
          accessibilityLabel="Refresh"
          testID="events-refresh-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <RefreshCw size={20} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* Search bar — filters the loaded events client-side. Cheap, no
          extra relay queries. */}
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
          {untrustedHidden > 0 ? (
            <Text style={styles.trustNote} testID="events-trust-note">
              {untrustedHidden} {untrustedHidden === 1 ? 'event' : 'events'} hidden from outside
              your trust graph.
            </Text>
          ) : null}
          <FlatList
            data={filteredEvents}
            keyExtractor={({ event }) => event.coord}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
              <EventRow
                event={item.event}
                distance={item.distance}
                // Highlight the first three unsearched results as
                // "Up next" — when the user is filtering by query the
                // highlight makes no sense, so skip it.
                upNext={searchQuery.trim() === '' && index < 3}
                expanded={expandedCoord === item.event.coord}
                onToggle={() =>
                  setExpandedCoord((prev) => (prev === item.event.coord ? null : item.event.coord))
                }
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
          {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
          {event.location ? ` · ${event.location}` : ''}
        </Text>
        {expanded ? (
          <View style={styles.expanded}>
            {event.imageUrl ? (
              <Image
                source={{ uri: event.imageUrl }}
                style={styles.expandedImage}
                resizeMode="cover"
              />
            ) : null}
            <Text style={styles.expandedDescription}>{event.description}</Text>
            {event.hashtags.length > 0 ? (
              <Text style={styles.expandedHashtags}>
                {event.hashtags.map((h) => `#${h}`).join(' · ')}
              </Text>
            ) : null}
            {event.location || event.geohash ? (
              <TouchableOpacity
                style={styles.locationButton}
                onPress={onOpenInMaps}
                testID={`event-row-${event.d}-open-in-maps`}
              >
                <MapPinned size={14} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.locationButtonText}>Open in Maps</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
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
    trustNote: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 6,
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
  });

export default EventsScreen;
