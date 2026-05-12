import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Linking,
  Share,
} from 'react-native';
import * as Calendar from 'expo-calendar';
import {
  CalendarPlus,
  ChevronLeft,
  Clock,
  MapPin,
  Navigation as NavigationIcon,
  Share2,
  Sparkles,
  Tag,
  User,
} from 'lucide-react-native';
import type { RouteProp } from '@react-navigation/native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import type { ParsedEvent } from '../services/nostrPlacesService';
import {
  loadCachedEvents,
  peekCachedEventsSync,
} from '../services/nostrPlacesStorage';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import ContactProfileSheet from '../components/ContactProfileSheet';
import Toast from '../components/BrandedToast';

interface Props {
  navigation: ExploreNavigation;
  route: RouteProp<ExploreStackParamList, 'EventDetail'>;
}

const formatDate = (ts: number | null): string => {
  if (ts === null) return 'Date TBC';
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Inline geohash decoder — same algorithm used elsewhere; kept duplicated
// so the screen has zero coupling to nostrPlacesService internals.
const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const decodeGeohash = (gh: string): { lat: number; lng: number } => {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let evenBit = true;
  for (let i = 0; i < gh.length; i += 1) {
    const idx = GEOHASH_BASE32.indexOf(gh[i].toLowerCase());
    if (idx < 0) continue;
    for (let bit = 4; bit >= 0; bit -= 1) {
      const set = (idx >> bit) & 1;
      if (evenBit) {
        const mid = (lonLo + lonHi) / 2;
        if (set) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (set) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { lat: (latLo + latHi) / 2, lng: (lonLo + lonHi) / 2 };
};

const EventDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { coord } = route.params;

  const [event, setEvent] = useState<ParsedEvent | null>(() => {
    // Fast path: in-memory mirror already has the event.
    const cached = peekCachedEventsSync().find((e) => e.coord === coord);
    return cached ?? null;
  });
  const [loading, setLoading] = useState(event === null);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);

  useEffect(() => {
    if (event !== null) return;
    let cancelled = false;
    loadCachedEvents().then((events) => {
      if (cancelled) return;
      const found = events.find((e) => e.coord === coord);
      if (found) setEvent(found);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [coord, event]);

  const organiser = usePubkeyProfile(event?.organiserPubkey ?? null);
  const organiserName =
    organiser.name ??
    (event ? `${event.organiserPubkey.slice(0, 8)}…${event.organiserPubkey.slice(-4)}` : '');

  const venueCoord = useMemo(() => {
    if (!event?.geohash) return null;
    return decodeGeohash(event.geohash);
  }, [event?.geohash]);

  const onOpenInMaps = useCallback(() => {
    if (!event) return;
    const q = event.location ?? (event.geohash ?? event.title);
    Linking.openURL(`geo:0,0?q=${encodeURIComponent(q)}`).catch(() => {
      Linking.openURL(`https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`).catch(
        () => {},
      );
    });
  }, [event]);

  const onAddToCalendar = useCallback(async () => {
    if (!event) return;
    try {
      const startMs = event.startsAt ? event.startsAt * 1000 : Date.now();
      const endMs = event.endsAt
        ? event.endsAt * 1000
        : // Default to a 2-hour event when the publisher omitted the end
          // tag (NIP-52 makes `end` optional).
          startMs + 2 * 60 * 60 * 1000;
      // `createEventInCalendarAsync` opens the OS calendar create-event
      // sheet with our fields pre-filled — works on iOS + Android and
      // doesn't require WRITE_CALENDAR. The user confirms in the OS UI
      // before the event is actually written.
      await Calendar.createEventInCalendarAsync({
        title: event.title,
        startDate: new Date(startMs),
        endDate: new Date(endMs),
        notes: event.description,
        location: event.location ?? undefined,
      });
    } catch (e) {
      Toast.show({
        type: 'info',
        text1: 'Couldn’t open calendar',
        text2: (e as Error).message,
      });
    }
  }, [event]);

  const onShare = useCallback(() => {
    if (!event) return;
    const when = formatDate(event.startsAt);
    Share.share({
      message: `${event.title} — ${when}${event.location ? ` · ${event.location}` : ''}`,
      title: event.title,
    }).catch(() => {});
  }, [event]);

  return (
    <View style={styles.container} testID="event-detail-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Events"
          testID="event-detail-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {event?.title ?? 'Event'}
        </Text>
        <TouchableOpacity
          onPress={onShare}
          accessibilityLabel="Share this event"
          testID="event-detail-share"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Share2 size={22} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.brandPink} style={{ marginTop: 40 }} />
        ) : !event ? (
          <Text style={styles.errorText}>
            This event isn’t in our local feed anymore. Reload the Events page to refetch.
          </Text>
        ) : (
          <>
            {event.imageUrl ? (
              <Image source={{ uri: event.imageUrl }} style={styles.hero} resizeMode="cover" />
            ) : null}

            <Text style={styles.title}>{event.title}</Text>

            <View style={styles.metaRow}>
              <Clock size={14} color={colors.brandPink} strokeWidth={2.5} />
              <Text style={styles.metaText}>{formatDate(event.startsAt)}</Text>
            </View>
            {event.location ? (
              <View style={styles.metaRow}>
                <MapPin size={14} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.metaText}>{event.location}</Text>
              </View>
            ) : null}

            {/* Organiser — tappable, opens the reusable profile sheet. */}
            <TouchableOpacity
              style={styles.organiserRow}
              onPress={() => setProfileSheetOpen(true)}
              testID="event-detail-organiser"
              accessibilityLabel={`Open ${organiserName} profile`}
            >
              {organiser.picture ? (
                <Image source={{ uri: organiser.picture }} style={styles.organiserAvatar} />
              ) : (
                <View style={[styles.organiserAvatar, styles.organiserAvatarFallback]}>
                  <User size={18} color={colors.brandPink} strokeWidth={2.5} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.organiserLabel}>Organised by</Text>
                <Text style={styles.organiserName} numberOfLines={1}>
                  {organiserName}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Mini-map centred on the event geohash. Shares the same
                component as PlaceDetail; tap → full Map. */}
            {venueCoord ? (
              <View style={styles.mapWrap}>
                <ExploreMiniMap
                  lat={venueCoord.lat}
                  lon={venueCoord.lng}
                  merchants={[]}
                  caches={[]}
                  events={[event]}
                  onTapMap={() => navigation.navigate('Map')}
                />
              </View>
            ) : null}

            {event.description ? (
              <Text style={styles.description}>{event.description}</Text>
            ) : null}

            {event.hashtags.length > 0 ? (
              <View style={styles.hashtagRow}>
                <Tag size={12} color={colors.textSupplementary} strokeWidth={2.5} />
                <Text style={styles.hashtagText}>
                  {event.hashtags.map((h) => `#${h}`).join(' · ')}
                </Text>
              </View>
            ) : null}

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonPrimary]}
                onPress={onAddToCalendar}
                testID="event-detail-add-to-calendar"
                accessibilityLabel="Add to calendar"
              >
                <CalendarPlus size={16} color={colors.white} strokeWidth={2.5} />
                <Text style={[styles.actionText, styles.actionTextPrimary]}>Add to calendar</Text>
              </TouchableOpacity>
              {event.location || event.geohash ? (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={onOpenInMaps}
                  testID="event-detail-open-in-maps"
                  accessibilityLabel="Open in Maps"
                >
                  <NavigationIcon size={16} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.actionText}>Open in Maps</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.attribution}>
              <Sparkles size={11} color={colors.textSupplementary} strokeWidth={2} />
              <Text style={styles.attributionText}>NIP-52 calendar event</Text>
            </View>
          </>
        )}
      </ScrollView>

      <ContactProfileSheet
        visible={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        contact={
          event
            ? {
                pubkey: event.organiserPubkey,
                name: organiserName,
                picture: organiser.picture,
                lightningAddress: organiser.lud16,
                source: 'nostr',
              }
            : null
        }
        onZap={
          organiser.lud16
            ? () => {
                const lud16 = organiser.lud16!;
                setProfileSheetOpen(false);
                Linking.openURL(`lightning:${lud16}`).catch(() => {});
              }
            : undefined
        }
      />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    body: { padding: 16, gap: 10 },
    hero: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    title: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.textHeader,
      lineHeight: 28,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    metaText: { fontSize: 14, color: colors.textHeader },
    organiserRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 8,
    },
    organiserAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
    },
    organiserAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    organiserLabel: {
      fontSize: 11,
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    organiserName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    mapWrap: { marginHorizontal: -16, marginVertical: 4 },
    description: {
      fontSize: 14,
      color: colors.textBody,
      lineHeight: 21,
      marginTop: 4,
    },
    hashtagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
    },
    hashtagText: { fontSize: 12, color: colors.textSupplementary },
    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: 100,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    actionButtonPrimary: {
      backgroundColor: colors.brandPink,
    },
    actionText: { color: colors.brandPink, fontSize: 14, fontWeight: '700' },
    actionTextPrimary: { color: colors.white },
    errorText: { fontSize: 14, color: colors.textHeader, marginTop: 20 },
    attribution: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 18,
      opacity: 0.7,
    },
    attributionText: { fontSize: 11, color: colors.textSupplementary },
  });

export default EventDetailScreen;
