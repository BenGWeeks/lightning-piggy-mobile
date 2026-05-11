import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { CalendarDays, ChevronRight, Compass, MapPin, PiggyBank, Zap } from 'lucide-react-native';
import TabHeader from '../components/TabHeader';
import { ContentRail } from '../components/ContentRail';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import { courses, type Course } from '../data/learnContent';
import {
  getProgress,
  LearnProgress,
  getCourseCompletedCount,
} from '../services/learnProgressService';
import {
  type BtcMapPlace,
  acceptsLightning,
  fetchPlacesInBbox,
  formatAddress,
  lightningAddressOf,
} from '../services/btcMapService';
import { type ParsedCache, type ParsedEvent } from '../services/nostrPlacesService';
import { subscribeNearbyCaches, subscribeNearbyEvents } from '../services/nostrPlacesPublisher';
import {
  decodeGeohash,
  encodeGeohash,
  formatDistance,
  geohashPrefixes,
  haversineMetres,
} from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { createExploreHomeScreenStyles } from '../styles/ExploreHomeScreen.styles';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Explore hub. Acts as a content surface, not a navigation menu — a
 * mini-map preview at the top renders local merchants + caches +
 * event venues over OSM tiles, and four content rails below preview
 * the same data the dedicated sub-screens display in full.
 *
 * Each rail subscribes to the same source its sub-screen uses
 * (BTC Map for places, NIP-GC kind 37516 for caches, NIP-52 kind
 * 31923 for events, local AsyncStorage for Lessons progress) so a
 * tap on a card opens the right detail directly. The header
 * "See all →" link routes to the full sub-screen and carries the
 * legacy `explore-card-{key}` testIDs so existing Maestro flows
 * keep navigating.
 */
const ExploreHomeScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createExploreHomeScreenStyles(colors), [colors]);
  const localStyles = useMemo(() => createLocalStyles(colors), [colors]);

  // Perf marker — same hook scripts/perf-startup.sh consumes.
  const renderLoggedRef = useRef(false);
  useEffect(() => {
    if (renderLoggedRef.current) return;
    renderLoggedRef.current = true;
    console.log(`[Perf] ExploreHomeScreen first render`);
  }, []);

  // ----- location ---------------------------------------------------------

  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Dev-only emulator fallback — see `getDevPinnedLocation`.
      const pinned = getDevPinnedLocation();
      if (pinned) {
        if (!cancelled) setPos(pinned);
        return;
      }
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      // Fast path: surface last-known position immediately so the
      // rails + mini-map render content while we ask for a fresh fix
      // in parallel. On Android emulators `getCurrentPositionAsync` can
      // hang waiting on the simulated GPS HAL even with `geo fix`
      // ticking; on real devices it usually returns in under a second.
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 10 * 60 * 1000, // ≤ 10 min old is fine for our 5 km tiles
        });
        if (!cancelled && last) {
          setPos({ lat: last.coords.latitude, lon: last.coords.longitude });
        }
      } catch {
        // Non-fatal — fall through to getCurrentPositionAsync.
      }
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setPos({ lat: current.coords.latitude, lon: current.coords.longitude });
        }
      } catch (e) {
        // If getCurrentPositionAsync rejects AND we never got a
        // last-known, mark the rails as denied so they show the
        // friendlier "grant location" copy.
        if (!cancelled && !pos) setLocationDenied(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- BTC Map merchants ------------------------------------------------

  const [merchants, setMerchants] = useState<BtcMapPlace[]>([]);
  const [merchantsLoading, setMerchantsLoading] = useState(true);
  useEffect(() => {
    if (!pos) return;
    let cancelled = false;
    (async () => {
      setMerchantsLoading(true);
      try {
        // ~50 km half-side around the user. Rural users (Longstanton,
        // Highlands, mid-Wales) sit in 0-merchant 5 km tiles; widening
        // to ~50 km surfaces the closest drive-away merchants on the
        // rail without paying for a country-wide query.
        const places = await fetchPlacesInBbox({
          minLon: pos.lon - 0.5,
          minLat: pos.lat - 0.5,
          maxLon: pos.lon + 0.5,
          maxLat: pos.lat + 0.5,
        });
        if (!cancelled) setMerchants(places);
      } catch {
        // BTC Map outage shouldn't break the whole hub — empty rail.
      } finally {
        if (!cancelled) setMerchantsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pos]);

  // ----- NIP-GC caches + NIP-52 events (live subs) ------------------------

  // Web-of-trust filter — kept in a ref so the subscription callbacks
  // always see the current `isTrusted` predicate without resubscribing
  // every time the trust set churns (L2 backfill, contact-list updates).
  const { isTrusted, filterEnabled } = useTrustGraph();
  const isTrustedRef = useRef(isTrusted);
  useEffect(() => {
    isTrustedRef.current = isTrusted;
  }, [isTrusted]);

  const [caches, setCaches] = useState<Map<string, ParsedCache>>(new Map());
  const [events, setEvents] = useState<Map<string, ParsedEvent>>(new Map());
  // Counts of events arriving from pubkeys outside the trust set.
  // Surfaced as "N hidden — from outside your trust graph" so users
  // know the filter is doing something.
  const [untrustedCacheCount, setUntrustedCacheCount] = useState(0);
  const [untrustedEventCount, setUntrustedEventCount] = useState(0);
  const subsCloserRef = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (!pos) return;
    const myGh = encodeGeohash(pos.lat, pos.lon, 7);
    // Caches sit at precision 5 (~5 km) — geocaching is inherently
    // hyper-local. Events broaden to precision 3 (~150 km) so a rural
    // user catches the nearest city's Bitcoin meetup; most NIP-52
    // publishers emit g tags at every precision 3..9.
    const cachePrefixes = geohashPrefixes(myGh, 5).filter((p) => p.length === 5);
    const eventPrefixes = geohashPrefixes(myGh, 3).filter((p) => p.length === 3);

    subsCloserRef.current.push(
      subscribeNearbyCaches(cachePrefixes, (c) => {
        // WoT filter: silently drop caches from pubkeys outside the
        // trust graph (an unverified cache could be a phishing LNURL
        // or, worse, a physical lure). Surfaced as a count instead so
        // users know they exist without being lured into inspecting them.
        if (filterEnabled && !isTrustedRef.current(c.hiderPubkey)) {
          setUntrustedCacheCount((n) => n + 1);
          return;
        }
        setCaches((prev) => {
          const existing = prev.get(c.coord);
          if (existing && existing.createdAt >= c.createdAt) return prev;
          const next = new Map(prev);
          next.set(c.coord, c);
          return next;
        });
      }),
    );
    subsCloserRef.current.push(
      subscribeNearbyEvents(eventPrefixes, (e) => {
        // Skip events that already started > 1h ago.
        if (e.startsAt && e.startsAt < Math.floor(Date.now() / 1000) - 60 * 60) return;
        if (filterEnabled && !isTrustedRef.current(e.organiserPubkey)) {
          setUntrustedEventCount((n) => n + 1);
          return;
        }
        setEvents((prev) => {
          const existing = prev.get(e.coord);
          if (existing && existing.startsAt === e.startsAt) return prev;
          const next = new Map(prev);
          next.set(e.coord, e);
          return next;
        });
      }),
    );
    return () => {
      subsCloserRef.current.forEach((c) => c());
      subsCloserRef.current = [];
    };
  }, [pos]);

  // ----- lessons progress (local) -----------------------------------------

  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });
  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, []),
  );

  // ----- derived rail data ------------------------------------------------
  //
  // Every rail is sorted by haversine distance from the user so the
  // nearest row sits leftmost. Items without a usable location land
  // at the end. We tag each entry with a `distance` number so the
  // card variants can render an "X km" badge without recomputing.

  const sortedMerchants = useMemo(() => {
    if (!pos) return [] as { place: BtcMapPlace; distance: number }[];
    return merchants
      .map((place) => ({
        place,
        distance: haversineMetres(
          { lat: pos.lat, lon: pos.lon },
          { lat: place.lat, lon: place.lon },
        ),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 12);
  }, [merchants, pos]);

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
    return items.slice(0, 12);
  }, [caches, pos]);

  const sortedEvents = useMemo(() => {
    const items = [...events.values()].map((event) => {
      const center = event.geohash ? decodeGeohash(event.geohash) : null;
      const distance =
        pos && center
          ? haversineMetres({ lat: pos.lat, lon: pos.lon }, { lat: center.lat, lon: center.lng })
          : Number.POSITIVE_INFINITY;
      return { event, distance };
    });
    items.sort((a, b) => a.distance - b.distance);
    return items.slice(0, 12);
  }, [events, pos]);

  return (
    <View style={styles.container}>
      <View style={styles.headerBackground}>
        <Image
          source={require('../../assets/images/learn-header-bg.png')}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <View style={styles.headerOverlay} />
        <TabHeader title="Explore" icon={<Compass size={20} color={colors.brandPink} />} />
        <View style={styles.headerExtras}>
          <Text style={styles.tagline}>Find your way around Bitcoin</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={localStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {locationDenied ? (
          <View style={localStyles.deniedCard}>
            <MapPin size={20} color={colors.brandPink} strokeWidth={2.5} />
            <View style={{ flex: 1 }}>
              <Text style={localStyles.deniedTitle}>Allow location for nearby content</Text>
              <Text style={localStyles.deniedSub}>
                We use a coarse 5 km area to find merchants, caches, and meetups around you. Nothing
                leaves your device beyond that.
              </Text>
            </View>
          </View>
        ) : (
          <ExploreMiniMap
            lat={pos?.lat ?? null}
            lon={pos?.lon ?? null}
            merchants={merchants}
            caches={[...caches.values()]}
            events={[...events.values()]}
            loading={merchantsLoading && caches.size === 0}
            onTapMap={() => navigation.navigate('Map')}
          />
        )}

        <ContentRail<{ place: BtcMapPlace; distance: number }>
          title="Places near you"
          caption="Bitcoin-accepting merchants from BTC Map"
          items={sortedMerchants}
          loading={merchantsLoading && sortedMerchants.length === 0 && !!pos}
          // "See all" lands on the Places list (with map button in
          // its header); the dedicated Map view is one tap away.
          onSeeAll={() => navigation.navigate('Places')}
          seeAllTestId="explore-card-map"
          keyExtractor={(p) => String(p.place.id)}
          emptyState={
            <Text style={localStyles.emptyText}>
              {pos
                ? 'No merchants in your immediate area — try the full Map for a wider view.'
                : 'Grant location to discover Bitcoin-accepting shops near you.'}
            </Text>
          }
          renderItem={({ place, distance }) => (
            <PlaceCard
              place={place}
              distance={distance}
              onPress={() => navigation.navigate('PlaceDetail', { placeId: place.id })}
              colors={colors}
              styles={localStyles}
            />
          )}
        />

        <ContentRail<{ cache: ParsedCache; distance: number }>
          title="Geo-caches near you"
          caption={
            untrustedCacheCount > 0
              ? `Piglets + classic NIP-GC caches · ${untrustedCacheCount} hidden from outside your trust graph`
              : 'Piglets + classic NIP-GC caches'
          }
          items={sortedCaches}
          loading={!!pos && caches.size === 0}
          // "See all" lands users on the Discover list directly — the
          // Hunt hub is for hiders. Per UX feedback (most users find,
          // few hide).
          onSeeAll={() => navigation.navigate('HuntDiscover')}
          seeAllTestId="explore-card-hunt"
          keyExtractor={(c) => c.cache.coord}
          emptyState={
            <Text style={localStyles.emptyText}>
              No caches in your area yet. Tap See all → Hide a Piggy to be the first.
            </Text>
          }
          renderItem={({ cache, distance }) => (
            <CacheCard
              cache={cache}
              distance={distance}
              onPress={() => navigation.navigate('HuntPiggyDetail', { coord: cache.coord })}
              colors={colors}
              styles={localStyles}
            />
          )}
        />

        <ContentRail<{ event: ParsedEvent; distance: number }>
          title="Events near you"
          caption={
            untrustedEventCount > 0
              ? `Bitcoin meetups within ~150 km · ${untrustedEventCount} hidden from outside your trust graph`
              : 'Bitcoin meetups within ~150 km · NIP-52'
          }
          items={sortedEvents}
          loading={!!pos && events.size === 0 && false}
          onSeeAll={() => navigation.navigate('Events')}
          seeAllTestId="explore-card-events"
          keyExtractor={(e) => e.event.coord}
          emptyState={
            <Text style={localStyles.emptyText}>
              No upcoming meetups in your area on the NIP-52 feed right now.
            </Text>
          }
          renderItem={({ event, distance }) => (
            <EventCard
              event={event}
              distance={distance}
              onPress={() => navigation.navigate('Events')}
              colors={colors}
              styles={localStyles}
            />
          )}
        />

        <ContentRail<Course>
          title="Lessons in progress"
          caption={`${progress.completedMissions.length} / ${courses.reduce((a, c) => a + c.missions.length, 0)} missions done`}
          items={courses}
          onSeeAll={() => navigation.navigate('Lessons')}
          seeAllTestId="explore-card-lessons"
          keyExtractor={(c) => c.id}
          renderItem={(course) => (
            <LessonCard
              course={course}
              progress={progress}
              onPress={() => navigation.navigate('CourseDetail', { courseId: course.id })}
              colors={colors}
              styles={localStyles}
            />
          )}
        />
      </ScrollView>
    </View>
  );
};

// -----------------------------------------------------------------------------
// rail card variants
// -----------------------------------------------------------------------------

const PlaceCard: React.FC<{
  place: BtcMapPlace;
  distance: number;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createLocalStyles>;
}> = ({ place, distance, onPress, colors, styles }) => {
  const lightning = acceptsLightning(place);
  const lud16 = lightningAddressOf(place);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} testID={`place-card-${place.id}`}>
      <View
        style={[styles.cardIcon, lightning ? styles.cardIconLightning : styles.cardIconOnchain]}
      >
        {lightning ? (
          <Zap size={20} color={colors.white} strokeWidth={2.5} />
        ) : (
          <MapPin size={20} color={colors.white} strokeWidth={2.5} />
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {place.tags.name ?? 'Unnamed merchant'}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {lightning ? '⚡ Lightning' : 'On-chain'}
        {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
      </Text>
      <Text style={styles.cardSubSmall} numberOfLines={1}>
        {lud16 ?? formatAddress(place)}
      </Text>
    </TouchableOpacity>
  );
};

const CacheCard: React.FC<{
  cache: ParsedCache;
  distance: number;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createLocalStyles>;
}> = ({ cache, distance, onPress, colors, styles }) => (
  <TouchableOpacity style={styles.card} onPress={onPress} testID={`cache-card-${cache.d}`}>
    {cache.imageUrl ? (
      <Image source={{ uri: cache.imageUrl }} style={styles.cardThumb} resizeMode="cover" />
    ) : (
      // Same-shape placeholder so cards align visually whether or
      // not the hider attached a hint photo. LP Piggies get a pink
      // panel + piggy glyph; vanilla NIP-GC caches get a slate
      // panel + map-pin glyph.
      <View
        style={[
          styles.cardThumb,
          styles.cardThumbPlaceholder,
          cache.isLpPiggy ? styles.cardIconLightning : styles.cardIconStandard,
        ]}
      >
        {cache.isLpPiggy ? (
          <PiggyBank size={32} color={colors.white} strokeWidth={2} />
        ) : (
          <MapPin size={32} color={colors.white} strokeWidth={2} />
        )}
      </View>
    )}
    <Text style={styles.cardTitle} numberOfLines={2}>
      {cache.name}
    </Text>
    <Text style={styles.cardSub} numberOfLines={1}>
      {cache.isLpPiggy ? 'Piglet' : 'NIP-GC cache'}
      {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
    </Text>
    <Text style={styles.cardSubSmall} numberOfLines={1}>
      {cache.cacheType ?? 'traditional'} · {cache.size ?? 'micro'}
    </Text>
  </TouchableOpacity>
);

const EventCard: React.FC<{
  event: ParsedEvent;
  distance: number;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createLocalStyles>;
}> = ({ event, distance, onPress, colors, styles }) => {
  const day = event.startsAt
    ? new Date(event.startsAt * 1000).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : 'Soon';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} testID={`event-card-${event.d}`}>
      {event.imageUrl ? (
        <Image source={{ uri: event.imageUrl }} style={styles.cardThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.cardThumb, styles.cardThumbPlaceholder, styles.cardIconEvent]}>
          <CalendarDays size={32} color={colors.white} strokeWidth={2} />
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {day}
        {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
      </Text>
      {event.location ? (
        <Text style={styles.cardSubSmall} numberOfLines={1}>
          {event.location}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

const LessonCard: React.FC<{
  course: Course;
  progress: LearnProgress;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createLocalStyles>;
}> = ({ course, progress, onPress, colors, styles }) => {
  const completed = getCourseCompletedCount(
    progress,
    course.missions.map((m) => m.id),
  );
  const total = course.missions.length;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} testID={`lesson-card-${course.id}`}>
      <Image source={course.image} style={styles.cardThumb} resizeMode="cover" />
      <Text style={styles.cardTitle} numberOfLines={2}>
        {course.title}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {completed}/{total} missions
      </Text>
      {completed === total ? (
        <Text style={[styles.cardSubSmall, { color: colors.green }]} numberOfLines={1}>
          ✓ Complete
        </Text>
      ) : (
        <Text style={styles.cardSubSmall} numberOfLines={1}>
          <ChevronRight size={11} color={colors.brandPink} /> Continue
        </Text>
      )}
    </TouchableOpacity>
  );
};

// -----------------------------------------------------------------------------
// styles local to the rails / cards / hub-specific bits
// -----------------------------------------------------------------------------

const createLocalStyles = (colors: Palette) =>
  StyleSheet.create({
    scrollContent: {
      paddingTop: 18,
      paddingBottom: 32,
    },
    card: {
      width: 160,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 4,
    },
    cardIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    cardThumb: {
      width: '100%',
      height: 80,
      borderRadius: 8,
      marginBottom: 6,
      backgroundColor: colors.divider,
    },
    cardThumbPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardIconLightning: { backgroundColor: colors.brandPink },
    cardIconOnchain: { backgroundColor: '#F5A623' },
    cardIconStandard: { backgroundColor: '#6c7b8a' },
    cardIconEvent: { backgroundColor: '#5b3aff' },
    cardTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeader,
    },
    cardSub: {
      fontSize: 11,
      color: colors.textSupplementary,
      fontWeight: '600',
    },
    cardSubSmall: {
      fontSize: 11,
      color: colors.textSupplementary,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 19,
    },
    deniedCard: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginBottom: 18,
      padding: 14,
      borderRadius: 12,
      alignItems: 'flex-start',
    },
    deniedTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    deniedSub: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 4,
      lineHeight: 17,
    },
  });

export default ExploreHomeScreen;
