import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  Boxes,
  Box,
  Camera,
  CalendarDays,
  ChevronLeft,
  Pencil,
  Clock,
  Cloud,
  Eye,
  EyeOff,
  HelpCircle,
  ImagePlus,
  MapPin,
  Navigation,
  Navigation2,
  PiggyBank,
  Repeat,
  Send,
  Gift,
  User,
  X,
  Zap,
} from 'lucide-react-native';
import {
  type CompositeNavigationProp,
  type RouteProp,
  useFocusEffect,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { parseFoundLog, type FoundLog } from '../utils/foundLog';
import { useThemeColors } from '../contexts/ThemeContext';
import { useNostr } from '../contexts/NostrContext';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import { useContactProfileSheet } from '../hooks/useContactProfileSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import SendSheet from '../components/SendSheet';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import { buildFoundLog, parseCacheCoord, type ParsedCache } from '../services/nostrPlacesService';
import { LibreMiniMap } from '../components/LibreMiniMap';
import CacheSpecSheet from '../components/CacheSpecSheet';
import { decodeGeohash, formatDistance } from '../utils/geohash';
import { useCompassNavigation } from '../hooks/useCompassNavigation';
import { useUserLocation } from '../contexts/UserLocationContext';
import { shortNpub } from '../utils/shortNpub';
import {
  fetchCache,
  publishCacheEvent,
  subscribeFoundLogs,
} from '../services/nostrPlacesPublisher';
import { loadCachedCaches, peekCachedCachesSync } from '../services/nostrPlacesStorage';
import { subscribeFindLogZaps } from '../services/findLogZapsService';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';
import { lastClaimForPiggyId } from '../services/claimHistoryService';
import NfcReadSheet from '../components/NfcReadSheet';

// Composite nav type — needed so we can `navigate('Conversation', …)`
// when the hider's profile sheet's Message action is tapped. The
// Conversation route lives on the root stack, not the Explore stack;
// composite props expose both navigators in one type.
type HuntPiggyDetailNavigation = CompositeNavigationProp<
  ExploreNavigation,
  NativeStackNavigationProp<RootStackParamList>
>;

interface Props {
  navigation: HuntPiggyDetailNavigation;
  route: RouteProp<ExploreStackParamList, 'HuntPiggyDetail'>;
}

/**
 * Detail view for a single Hunt cache. Resolves the kind 37516 listing
 * by coord, subscribes to its kind 7516 found-log thread (NIP-GC), and
 * lets the user post their own found-log entry with an optional photo
 * once they've claimed sats from the cache (proven by the local
 * claimHistoryService — the kind 7516 event's `amount` tag is what
 * drives the `⚡ claimed` badge for other readers).
 *
 * The post-find compose flow uses the existing image pipeline
 * (`stripImageMetadata` + `uploadImage` to Blossom / nostr.build) and
 * `signEvent` from NostrContext so it works with both nsec and Amber
 * signers.
 */
const HuntPiggyDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { coord, openComposer: openComposerParam } = route.params;
  const { signEvent, relays, pubkey, profile } = useNostr();

  // Seed from the in-memory cache mirror so the screen paints instantly
  // when the user navigates from Explore / Hunt rails (where the cache
  // is already in memory). Falls through to fetchCache() below for
  // cold-tap deep-links where the mirror is empty. Pre-fix the screen
  // showed a 15-30s loading spinner whenever the JS thread was busy.
  const [cache, setCache] = useState<ParsedCache | null>(
    () => peekCachedCachesSync().find((c) => c.coord === coord) ?? null,
  );
  const [loading, setLoading] = useState(
    () => !peekCachedCachesSync().some((c) => c.coord === coord),
  );
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Map<string, FoundLog>>(new Map());
  // Zap totals per find-log id. Outer key is the kind-7516 log id;
  // inner Map is keyed by kind-9735 receipt id so the same zap arriving
  // from multiple relays only counts once. Sum the inner values for the
  // total displayed on the row.
  const [zapsByLog, setZapsByLog] = useState<Map<string, Map<string, number>>>(new Map());
  // In-app NIP-57 zap target. `null` keeps the SendSheet closed; an
  // object opens it pre-targeted at that finder and scoped to that log
  // (via the 9734 `e` tag → 9735 `e` tag echo).
  const [zapTarget, setZapTarget] = useState<{
    lud16: string;
    pubkey: string;
    name: string | null;
    // Set when zapping a specific find-log (scopes the 9734 → 9735 so the
    // row's "zapped" pill updates). Unset when zapping the hider/finder
    // straight from their profile sheet — there's no log to attribute to.
    logId?: string;
  } | null>(null);
  const openZapForLog = useCallback((log: FoundLog, lud16: string, name: string | null) => {
    setZapTarget({ lud16, pubkey: log.pubkey, name, logId: log.id });
  }, []);
  // Zap requested from a contact's profile sheet (hider or finder). Routes
  // through the same in-app SendSheet, just without a find-log scope.
  const openZapForContact = useCallback(
    (target: { pubkey: string; name: string; lud16: string }) => {
      setZapTarget({ lud16: target.lud16, pubkey: target.pubkey, name: target.name });
    },
    [],
  );
  // Composer is always rendered (no toggle) — sharing a find is
  // independent of trying the LP prize. The route-param + scroll
  // effect just nudges the page to the composer when navigation
  // bounces back from HuntFoundScreen after a successful claim, so
  // the finder lands on the input ready to type rather than at the
  // top of a long cache page.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!openComposerParam) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [openComposerParam]);
  const [composerText, setComposerText] = useState('');
  const [composerPhotoUrl, setComposerPhotoUrl] = useState<string | null>(null);
  const [composerUploading, setComposerUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  // Hints are ROT13-encoded on-relay per NIP-GC convention so generic
  // clients can't accidentally spoiler the find. We decode at parse
  // time but only reveal in the UI when the hunter explicitly taps —
  // that preserves the "stuck? unhide" experience geocachers expect.
  const [hintRevealed, setHintRevealed] = useState(false);
  // Reusable contact profile bottom sheet — opened when the user taps the
  // hider's row at the top of the screen or any find-log row. The hook
  // owns the sheet state + re-resolves the verified profile so the banner
  // and Lightning address are real (mirrors ConversationScreen). Its zaps
  // route back into this screen's in-app SendSheet via openZapForContact.
  const contactSheet = useContactProfileSheet(navigation, openZapForContact);
  const { openProfileSheet } = contactSheet;
  // Finder NFC reader sheet — opens on "Try prize" tap. The sheet
  // owns the entire flow now (foreground reader → LNURLw resolve →
  // claim → success / sleeping / error) so no navigation is needed
  // here. On dismissal the user lands back on this detail screen with
  // the find-log composer already in view.
  const [readSheetOpen, setReadSheetOpen] = useState(false);
  // Hero slot toggles between the cache photo and a map; defaults to the
  // photo when one exists, otherwise the render falls back to the map.
  const [heroView, setHeroView] = useState<'photo' | 'map'>('photo');

  // Compass-navigation feed — live user position, device heading, and
  // bearing/distance to the cache. Drives the rotating Navigate arrow,
  // the distance label, and the blue user-dot on the map hero. Returns
  // all-null until permission is granted and a fix lands; UI degrades
  // gracefully (no rotation, no distance) in that case.
  const cacheLatLon = useMemo(
    () => (cache?.geohash ? decodeGeohash(cache.geohash) : null),
    [cache?.geohash],
  );
  const compassTarget = useMemo(
    () => (cacheLatLon ? { lat: cacheLatLon.lat, lon: cacheLatLon.lng } : null),
    [cacheLatLon],
  );
  const {
    user: compassUser,
    userAccuracy: compassAccuracy,
    heading,
    bearing,
    distanceMetres,
  } = useCompassNavigation(compassTarget);
  // Fallback to cached UserLocation so the user dot shows from the first
  // frame; useCompassNavigation's fresh GPS watch can take ~2 s to settle.
  const { pos: cachedUser } = useUserLocation();
  const userPos = compassUser ?? (cachedUser ? { lat: cachedUser.lat, lon: cachedUser.lon } : null);
  const userAccuracy = compassAccuracy ?? cachedUser?.accuracy ?? null;
  // lucide's Navigation2 glyph is a symmetric arrowhead pointing
  // straight up at rest, so rotation = (bearing − heading) puts the
  // apex on the cache relative to where the phone is facing. (The
  // older Navigation glyph rests at 45° up-right and would have needed
  // a −45° offset; Navigation2 is cleaner for compass use.)
  const arrowRotation = bearing !== null && heading !== null ? bearing - heading : null;

  // ----- load listing + subscribe found-logs ------------------------------

  // Coalesce per-log Map clones into one setState per ≤150 ms flush.
  // Without batching a relay burst fires N × O(prev) Map clones + React
  // commits on every arriving event. Mirror of the zapsByLog pattern
  // ~50 lines below. (#1029 Fix 1)
  const pendingLogsRef = useRef<Map<string, FoundLog>>(new Map());
  const logFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const parts = parseCacheCoord(coord);
    if (!parts) {
      setError('Invalid cache coordinate.');
      setLoading(false);
      return;
    }

    const flushLogs = (): void => {
      if (logFlushTimerRef.current) {
        clearTimeout(logFlushTimerRef.current);
        logFlushTimerRef.current = null;
      }
      if (pendingLogsRef.current.size === 0) return;
      const batch = pendingLogsRef.current;
      pendingLogsRef.current = new Map();
      setLogs((prev) => {
        // Dedupe: skip any id already committed so we don't clobber a
        // newer optimistic insert (the handlePostLog path).
        let changed = false;
        const next = new Map(prev);
        for (const [id, log] of batch) {
          if (next.has(id)) continue;
          next.set(id, log);
          changed = true;
        }
        return changed ? next : prev;
      });
    };

    (async () => {
      // Paint from disk first (cold deep-link path) to hide relay latency.
      if (!cache) {
        try {
          const onDisk = await loadCachedCaches();
          if (cancelled) return;
          const local = onDisk.find((c) => c.coord === coord);
          if (local) {
            setCache(local);
            setLoading(false);
          }
        } catch {
          // AsyncStorage hiccups are non-fatal — fall through to relays.
        }
      }
      try {
        const c = await fetchCache(parts.pubkey, parts.d);
        if (cancelled) return;
        if (!c) {
          // Only error when there's no cached snapshot to fall back on.
          if (!cache) setError('Cache not found on relays — it may have expired.');
        } else {
          setCache(c);
        }
      } catch (e) {
        if (!cancelled && !cache) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const closer = subscribeFoundLogs(coord, (event) => {
      const log = parseFoundLog(event);
      pendingLogsRef.current.set(log.id, log);
      if (pendingLogsRef.current.size >= 25) {
        flushLogs();
        return;
      }
      if (logFlushTimerRef.current === null) logFlushTimerRef.current = setTimeout(flushLogs, 150);
    });
    return () => {
      cancelled = true;
      flushLogs(); // drain tail so no events are lost on unmount
      closer();
    };
  }, [coord]);

  // Refetch on return from HuntCreate (edit) or on pull-to-refresh so
  // renames/spec changes show immediately (mount effect fires once only).
  const refetchCache = useCallback(async () => {
    const parts = parseCacheCoord(coord);
    if (!parts) return;
    try {
      const c = await fetchCache(parts.pubkey, parts.d);
      if (c) setCache(c);
    } catch {
      // Non-fatal — keep the current render until next attempt.
    }
  }, [coord]);

  // Skip first focus — ref avoids dep on `cache` which would re-run
  // the callback after every relay round-trip (infinite loop; #572).
  const isFirstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocusRef.current) {
        isFirstFocusRef.current = false;
        return;
      }
      void refetchCache();
    }, [refetchCache]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchCache();
    } finally {
      setRefreshing(false);
    }
  }, [refetchCache]);

  // Re-subscribe to kind-9735 zap receipts on the `#e` tag of find-logs.
  // Keyed on sorted log ids so a new log re-opens the sub while an
  // unchanged set doesn't. Receipts deduped by receiptId across relays.
  const logIdsKey = useMemo(() => [...logs.keys()].sort().join(','), [logs]);
  // Coalesce per-zap Map clones into one setState per ≤150 ms flush.
  // Without batching a relay burst fires N × O(prev) Map clones. (#739 Fix 4)
  const pendingZapsRef = useRef<{ receiptId: string; logId: string; sats: number }[]>([]);
  const zapFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const logIds = logIdsKey ? logIdsKey.split(',') : [];
    if (logIds.length === 0) return undefined;
    const flush = (): void => {
      if (zapFlushTimerRef.current) {
        clearTimeout(zapFlushTimerRef.current);
        zapFlushTimerRef.current = null;
      }
      if (pendingZapsRef.current.length === 0) return;
      const batch = pendingZapsRef.current;
      pendingZapsRef.current = [];
      setZapsByLog((prev) => {
        const next = new Map(prev);
        for (const { receiptId, logId, sats } of batch) {
          const inner = next.get(logId);
          if (inner && inner.has(receiptId)) continue; // already counted
          const nextInner = new Map(inner ?? []);
          nextInner.set(receiptId, sats);
          next.set(logId, nextInner);
        }
        return next;
      });
    };
    const closer = subscribeFindLogZaps(logIds, ({ receiptId, logId, sats }) => {
      pendingZapsRef.current.push({ receiptId, logId, sats });
      if (pendingZapsRef.current.length >= 25) {
        flush();
        return;
      }
      if (zapFlushTimerRef.current === null) zapFlushTimerRef.current = setTimeout(flush, 150);
    });
    return () => {
      closer();
      flush();
    };
  }, [logIdsKey]);

  // ----- composer image picker -------------------------------------------

  const uploadComposerPhoto = useCallback(
    async (uri: string, base64?: string | null) => {
      setComposerUploading(true);
      try {
        const scrubbed = await stripImageMetadata(uri, base64);
        const url = await uploadImage(scrubbed.uri, signEvent ?? null, scrubbed.base64);
        setComposerPhotoUrl(url);
      } catch (e) {
        Alert.alert('Upload failed', (e as Error).message, [{ text: 'OK' }]);
      } finally {
        setComposerUploading(false);
      }
    },
    [signEvent],
  );

  const handlePickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (r.canceled || !r.assets?.[0]) return;
    await uploadComposerPhoto(r.assets[0].uri, r.assets[0].base64);
  }, [uploadComposerPhoto]);

  const handleTakePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (r.canceled || !r.assets?.[0]) return;
    await uploadComposerPhoto(r.assets[0].uri, r.assets[0].base64);
  }, [uploadComposerPhoto]);

  // ----- post the kind 7516 found-log -------------------------------------

  const handlePostLog = useCallback(async () => {
    if (!cache || posting) return;
    if (!composerText.trim() && !composerPhotoUrl) {
      Alert.alert('Add a photo or comment', 'A found-log entry needs at least one of those.', [
        { text: 'OK' },
      ]);
      return;
    }
    setPosting(true);
    try {
      const claim = await lastClaimForPiggyId(coord);
      const unsigned = buildFoundLog(coord, composerText.trim() || 'Found it!', {
        imageUrl: composerPhotoUrl ?? undefined,
        sats: claim?.sats,
      });
      const signed = await signEvent(unsigned);
      if (!signed) {
        Toast.show({ type: 'error', text1: 'Could not sign your log' });
        return;
      }
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      await publishCacheEvent(signed, writeRelays.length > 0 ? writeRelays : undefined);
      // Optimistic insert so the new log shows immediately even before
      // the relay round-trips it back via the subscription.
      setLogs((prev) => {
        const next = new Map(prev);
        next.set(signed.id, {
          id: signed.id,
          pubkey: signed.pubkey,
          createdAt: signed.created_at,
          content: signed.content,
          imageUrl: composerPhotoUrl,
          amountSats: claim?.sats ?? null,
        });
        return next;
      });
      Toast.show({ type: 'success', text1: 'Log posted ⚡' });
      // Composer stays mounted — just clear so the user could post
      // another observation later in the same session.
      setComposerText('');
      setComposerPhotoUrl(null);
    } catch (e) {
      Alert.alert('Could not post log', (e as Error).message, [{ text: 'OK' }]);
    } finally {
      setPosting(false);
    }
  }, [cache, posting, composerText, composerPhotoUrl, signEvent, relays, coord]);

  // ----- render -----------------------------------------------------------

  const sortedLogs = useMemo(
    () => [...logs.values()].sort((a, b) => b.createdAt - a.createdAt),
    [logs],
  );

  // Per-log zap totals, flattened from the receipt-keyed inner Maps so
  // the row can render a single sats number cheaply on each draw.
  const zapTotalsByLog = useMemo(() => {
    const m = new Map<string, number>();
    for (const [logId, receipts] of zapsByLog) {
      let total = 0;
      for (const sats of receipts.values()) total += sats;
      if (total > 0) m.set(logId, total);
    }
    return m;
  }, [zapsByLog]);

  // Anyone can post a find-log on any cache (LP or vanilla NIP-GC).
  // Ben's framing: find-logs are unlimited and not gated on claim —
  // the LNURLw is a separate optional prize, surfaced inside the
  // composer as a 'Try for the prize' button so the finder gets a
  // shot at the sats without making it a precondition for sharing
  // their find.
  const canLog = cache != null;

  // Hero shows the photo when the toggle picks it AND a photo exists;
  // otherwise it falls back to the map.
  const showHeroPhoto = !!cache?.imageUrl && (heroView === 'photo' || !cache?.geohash);

  // Hand off to the device's maps app for walking directions to the
  // cache's geohash centroid; fall back to a Google Maps web URL.
  const openNavigation = useCallback(() => {
    if (!cache?.geohash) return;
    const { lat, lng } = decodeGeohash(cache.geohash);
    const label = encodeURIComponent(cache.name ?? 'Geo-cache');
    Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(${label})`).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(
        () => {},
      );
    });
  }, [cache]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      testID="hunt-piggy-detail-screen"
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
          testID="hunt-piggy-detail-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {cache?.name ?? 'Hunt cache'}
        </Text>
        {/* Edit affordance — only visible when the signed-in user
            authored this listing. Lower-cases both sides because some
            relays normalise pubkeys differently than the local cache. */}
        {cache && pubkey && cache.hiderPubkey.toLowerCase() === pubkey.toLowerCase() ? (
          <TouchableOpacity
            onPress={() =>
              // Carry the published cache fields as a fallback so the
              // wizard can hydrate even when the local HiddenPiggy
              // record is missing — the cross-device edit path (#596).
              // HuntCreate prefers the local record when present;
              // fallbackCache only fires when ownership is provable via
              // event.pubkey === activeIdentity.pubkey.
              navigation.navigate('HuntCreate', {
                piggyId: cache.d,
                fallbackCache: {
                  coord: cache.coord,
                  hiderPubkey: cache.hiderPubkey,
                  d: cache.d,
                  name: cache.name,
                  description: cache.description,
                  geohash: cache.geohash,
                  difficulty: cache.difficulty,
                  terrain: cache.terrain,
                  size: cache.size,
                  cacheType: cache.cacheType,
                  hint: cache.hint,
                  imageUrl: cache.imageUrl,
                  createdAt: cache.createdAt,
                  expiresAt: cache.expiresAt,
                  waitSeconds: cache.waitSeconds,
                  uses: cache.uses,
                  isLpPiggy: cache.isLpPiggy,
                  payoutSats: cache.payoutSats ?? null,
                },
              })
            }
            accessibilityLabel={cache.isLpPiggy ? 'Edit this Piglet' : 'Edit this cache'}
            testID="hunt-piggy-detail-edit-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Pencil size={20} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brandPink}
            colors={[colors.brandPink]}
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.brandPink} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : cache ? (
          <>
            {cache.imageUrl || cache.geohash ? (
              <View style={styles.heroWrap}>
                {showHeroPhoto && cache.imageUrl ? (
                  <Image source={{ uri: cache.imageUrl }} style={styles.hero} resizeMode="cover" />
                ) : cache.geohash ? (
                  <View style={styles.hero}>
                    <LibreMiniMap
                      fill
                      lat={decodeGeohash(cache.geohash).lat}
                      lon={decodeGeohash(cache.geohash).lng}
                      userLat={userPos?.lat ?? null}
                      userLon={userPos?.lon ?? null}
                      userAvatarUri={profile?.picture ?? null}
                      userAccuracyMetres={userAccuracy}
                      merchants={[]}
                      caches={[cache]}
                      events={[]}
                      onTapMap={() => navigation.navigate('Map')}
                    />
                  </View>
                ) : cache.imageUrl ? (
                  <Image source={{ uri: cache.imageUrl }} style={styles.hero} resizeMode="cover" />
                ) : null}
                {cache.imageUrl && cache.geohash ? (
                  <View style={styles.heroToggle}>
                    <TouchableOpacity
                      style={[styles.heroToggleBtn, showHeroPhoto && styles.heroToggleBtnActive]}
                      onPress={() => setHeroView('photo')}
                      accessibilityLabel="Show photo"
                      testID="hunt-piggy-detail-hero-photo"
                    >
                      <Camera size={18} color={colors.white} strokeWidth={2.5} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.heroToggleBtn, !showHeroPhoto && styles.heroToggleBtnActive]}
                      onPress={() => setHeroView('map')}
                      accessibilityLabel="Show map"
                      testID="hunt-piggy-detail-hero-map"
                    >
                      <MapPin size={18} color={colors.white} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}
            <CacheSpecPanel cache={cache} colors={colors} styles={styles} />
            {/* Navigate + Claim found show for every cache — "Claim found"
                means "I found it", which applies to any geocache. The
                only difference is the gate: an LP Piggy unlocks it by
                scanning the tag, a plain NIP-GC cache can log right away. */}
            <View style={styles.claimSection}>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionButtonSecondary}
                  onPress={openNavigation}
                  accessibilityLabel={
                    distanceMetres !== null
                      ? `Navigate to this cache — ${formatDistance(distanceMetres)} away`
                      : 'Navigate to this cache'
                  }
                  testID="hunt-piggy-detail-navigate-button"
                >
                  {/* The arrow IS the label. Two glyphs by design:
                      - When we have a compass heading, render Navigation2
                        (symmetric up-pointing arrowhead) rotated to
                        point at the cache. Reads as a real bearing.
                      - When we don't (emulator / no magnetometer / perm
                        denied), fall back to the classic Navigation
                        glyph at its native 45° tilt. That stays the
                        generic "go here / open in Maps" affordance
                        without implying a measured direction.
                      Transform lives on the View wrapper rather than
                      the icon's style prop — react-native-svg doesn't
                      reliably forward `transform: rotate` through, and
                      the icon was rendering invisibly on Pixel as a
                      result. View transforms are universal in RN. */}
                  <View
                    style={
                      arrowRotation !== null
                        ? { transform: [{ rotate: `${arrowRotation}deg` }] }
                        : undefined
                    }
                  >
                    {arrowRotation !== null ? (
                      <Navigation2 size={28} color={colors.brandPink} strokeWidth={2.5} />
                    ) : (
                      <Navigation size={28} color={colors.brandPink} strokeWidth={2.5} />
                    )}
                  </View>
                  {distanceMetres !== null ? (
                    <Text style={styles.actionButtonSecondaryText}>
                      {formatDistance(distanceMetres)}
                    </Text>
                  ) : null}
                </TouchableOpacity>
                {/* Primary action shows for LP Piggies only — opens the
                    NfcReadSheet to try the Lightning prize. The
                    find-log composer is independently available at the
                    bottom of this screen (always rendered), so the two
                    flows don't bundle: a finder can claim sats without
                    logging, or log without claiming. */}
                {/* Try prize shows only when the hider has BOTH labelled
                    this as a Lightning Piggy AND advertised a non-zero
                    sats prize (`amount` tag). Without an amount we
                    can't know whether the tag carries an LNURL at all;
                    showing the button would offer a scan that's
                    guaranteed to fail. */}
                {cache.isLpPiggy && (cache.payoutSats ?? 0) > 0 ? (
                  <TouchableOpacity
                    style={styles.actionButtonPrimary}
                    onPress={() => setReadSheetOpen(true)}
                    accessibilityLabel={`Try the prize — ${cache.payoutSats} sats`}
                    testID="hunt-piggy-detail-try-prize-button"
                  >
                    <Gift size={18} color={colors.white} strokeWidth={2.5} />
                    <Text style={styles.actionButtonPrimaryText}>Try prize</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.claimNote}>
                {cache.isLpPiggy && (cache.payoutSats ?? 0) > 0
                  ? 'Try the sats prize above, and share your find in the log below — both are optional.'
                  : 'Scroll down to share your find with other hunters.'}
              </Text>
            </View>

            <Text style={styles.description}>{cache.description}</Text>
            {cache.hint ? (
              <TouchableOpacity
                style={styles.hintCard}
                onPress={() => setHintRevealed((r) => !r)}
                accessibilityLabel={hintRevealed ? 'Hide hint' : 'Reveal hint'}
                testID="hunt-piggy-detail-hint"
              >
                {hintRevealed ? (
                  <EyeOff size={14} color={colors.brandPink} strokeWidth={2.5} />
                ) : (
                  <Eye size={14} color={colors.brandPink} strokeWidth={2.5} />
                )}
                <Text style={styles.hintText}>
                  {hintRevealed ? `Hint: ${cache.hint}` : 'Stuck? Tap to reveal the hint'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {/* Attribution — surface the hider so the finder knows
                whose word they're trusting before walking to a
                coordinate. The npub is shorthand-formatted; full
                profile UI lands later. The WoT filter would already
                have hidden this listing from any view if the hider
                weren't in the user's trust graph (see
                `trustGraphService` for the threat model). */}
            <HiderAttribution
              pubkey={cache.hiderPubkey}
              colors={colors}
              styles={styles}
              onPressProfile={openProfileSheet}
            />

            <Text style={styles.sectionLabel}>Find log ({sortedLogs.length})</Text>
            {sortedLogs.length === 0 ? (
              <Text style={styles.subtle}>
                No finds logged yet. {canLog ? 'Be the first to drop a log entry!' : ''}
              </Text>
            ) : (
              sortedLogs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  colors={colors}
                  styles={styles}
                  onPressProfile={openProfileSheet}
                  zapsReceivedSats={zapTotalsByLog.get(log.id) ?? 0}
                  onZap={openZapForLog}
                />
              ))
            )}

            {/* Always-visible find-log composer at the bottom of the
                screen — no toggle, no Cancel button. Sharing a find is
                an independent action from claiming the LP prize. */}
            {canLog ? (
              <View style={styles.composer}>
                <Text style={styles.composerHeader}>Share your find</Text>
                <TextInput
                  style={styles.composerInput}
                  placeholder="Found it! Tucked behind the bench, cleverly hidden."
                  placeholderTextColor={colors.textSupplementary}
                  value={composerText}
                  onChangeText={setComposerText}
                  // Scroll the composer into view above the keyboard
                  // when the user taps the input — KeyboardAvoidingView
                  // lifts the layout but a long find-log list above
                  // can still leave the input below the visible area.
                  onFocus={() => {
                    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
                  }}
                  multiline
                  testID="hunt-piggy-detail-compose-input"
                />
                {composerPhotoUrl ? (
                  <View style={styles.composerPhotoPreviewWrap}>
                    <Image
                      source={{ uri: composerPhotoUrl }}
                      style={styles.composerPhotoPreview}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      style={styles.composerPhotoRemove}
                      onPress={() => setComposerPhotoUrl(null)}
                      accessibilityLabel="Remove photo"
                    >
                      <X size={14} color={colors.white} strokeWidth={2.5} />
                    </TouchableOpacity>
                  </View>
                ) : composerUploading ? (
                  <ActivityIndicator color={colors.brandPink} />
                ) : (
                  <View style={styles.composerPhotoButtons}>
                    <TouchableOpacity style={styles.composerPhotoButton} onPress={handleTakePhoto}>
                      <Camera size={16} color={colors.brandPink} strokeWidth={2} />
                      <Text style={styles.composerPhotoButtonText}>Camera</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.composerPhotoButton}
                      onPress={handlePickFromLibrary}
                    >
                      <ImagePlus size={16} color={colors.brandPink} strokeWidth={2} />
                      <Text style={styles.composerPhotoButtonText}>Library</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={styles.composerActions}>
                  <TouchableOpacity
                    style={[
                      styles.composerPost,
                      styles.composerPostFull,
                      posting && styles.composerPostDim,
                    ]}
                    disabled={posting}
                    onPress={handlePostLog}
                    testID="hunt-piggy-detail-post-button"
                  >
                    {posting ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <>
                        <Send size={16} color={colors.white} strokeWidth={2.5} />
                        <Text style={styles.composerPostText}>Post log</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <ContactProfileSheet
        visible={contactSheet.profileSheet !== null}
        onClose={contactSheet.closeProfileSheet}
        contact={contactSheet.contact}
        canZap={contactSheet.canZap}
        onMessage={contactSheet.onMessage}
        onZap={contactSheet.onZap}
        onViewFullProfile={contactSheet.onViewFullProfile}
      />

      {/* In-app NIP-57 zap on a specific find-log. zapEventId scopes
          the 9734 to the log so the resulting 9735 receipt's `e` tag
          feeds back into subscribeFindLogZaps and bumps the row's
          "N zapped" pill in near-realtime. */}
      <SendSheet
        visible={zapTarget !== null}
        onClose={() => setZapTarget(null)}
        initialAddress={zapTarget?.lud16}
        recipientPubkey={zapTarget?.pubkey}
        recipientName={zapTarget?.name ?? undefined}
        zapEventId={zapTarget?.logId}
      />

      {/* Finder NFC reader. Opens when an unclaimed LP Piggy's "Scan
          the Piglet" button is tapped; on a successful tag read the
          handler navigates to HuntFoundScreen with the bearer LNURL
          and the cache coord so recordClaim can store the piggyId. */}
      <NfcReadSheet
        visible={readSheetOpen}
        onClose={() => setReadSheetOpen(false)}
        expectedCoord={coord}
      />
    </KeyboardAvoidingView>
  );
};

/**
 * "Hidden by …" row at the top of the cache detail. Resolves the
 * hider's display name + avatar via usePubkeyProfile so a finder
 * can see who they're trusting before walking to a coordinate.
 * Falls back to a shortened npub while the relay fetch is in flight.
 */
const HiderAttribution: React.FC<{
  pubkey: string;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
  onPressProfile: (
    pubkey: string,
    name: string | null,
    picture: string | null,
    lud16: string | null,
  ) => void;
}> = ({ pubkey, colors, styles, onPressProfile }) => {
  const { name, picture, lud16 } = usePubkeyProfile(pubkey);
  const display = name ?? shortNpub(pubkey);
  return (
    <TouchableOpacity
      style={styles.hiderRow}
      testID="hunt-piggy-detail-attribution"
      onPress={() => onPressProfile(pubkey, name, picture, lud16)}
      accessibilityLabel={`Open ${display} profile`}
    >
      {picture ? (
        <Image source={{ uri: picture }} style={styles.hiderAvatar} />
      ) : (
        <View style={[styles.hiderAvatar, styles.hiderAvatarFallback]}>
          <User size={20} color={colors.brandPink} strokeWidth={2.5} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.hiderName} numberOfLines={1}>
          Hidden by {display}
        </Text>
        <Text style={styles.hiderHint}>Verify you trust them before going to the location.</Text>
      </View>
    </TouchableOpacity>
  );
};

const LogRow: React.FC<{
  log: FoundLog;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
  onPressProfile: (
    pubkey: string,
    name: string | null,
    picture: string | null,
    lud16: string | null,
  ) => void;
  // Aggregate of NIP-57 zap receipts (kind 9735) referencing this
  // log — verifiable on-relay, so the copy reads "Zapped" rather
  // than the self-reported "Reported" used for the find-log's own
  // amount tag. Zero means none seen yet (no badge).
  zapsReceivedSats: number;
  // Open the in-app SendSheet pre-targeted at this finder, with the
  // 9734 zap request scoped to this log so the resulting 9735
  // receipt counts toward the row's zapped pill (closes the loop
  // with subscribeFindLogZaps).
  onZap: (log: FoundLog, lud16: string, name: string | null) => void;
}> = ({ log, colors, styles, onPressProfile, zapsReceivedSats, onZap }) => {
  const { name, picture, lud16 } = usePubkeyProfile(log.pubkey);
  const display = name ?? shortNpub(log.pubkey);
  const ageMins = Math.floor((Date.now() / 1000 - log.createdAt) / 60);
  const ageLabel =
    ageMins < 60
      ? `${ageMins}m ago`
      : ageMins < 60 * 24
        ? `${Math.floor(ageMins / 60)}h ago`
        : `${Math.floor(ageMins / (60 * 24))}d ago`;
  return (
    <View style={styles.logRow} testID={`hunt-log-${log.id.slice(0, 8)}`}>
      <TouchableOpacity
        style={styles.logHeader}
        onPress={() => onPressProfile(log.pubkey, name, picture, lud16)}
        testID={`hunt-log-${log.id.slice(0, 8)}-profile`}
        accessibilityLabel={`Open ${display} profile`}
      >
        {picture ? (
          <Image source={{ uri: picture }} style={styles.logAvatar} />
        ) : (
          <View style={[styles.logAvatar, styles.hiderAvatarFallback]}>
            <User size={16} color={colors.brandPink} strokeWidth={2.5} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.logAuthor} numberOfLines={1}>
            {display}
          </Text>
          <Text style={styles.logAge}>{ageLabel}</Text>
        </View>
      </TouchableOpacity>
      {log.imageUrl ? (
        <Image source={{ uri: log.imageUrl }} style={styles.logImage} resizeMode="cover" />
      ) : null}
      <Text style={styles.logContent}>{log.content}</Text>
      <View style={styles.logFooter}>
        {log.amountSats ? (
          // Self-reported by the finder — the found-log event isn't
          // verifiable, so the copy says "reported", not "claimed".
          <View style={styles.logBadge}>
            <Zap size={12} color={colors.zapYellow} fill={colors.zapYellow} strokeWidth={2.5} />
            <Text style={styles.logBadgeText}>Reported {log.amountSats.toLocaleString()} sats</Text>
          </View>
        ) : (
          <View />
        )}
        {/* Compact icon-only zap action — Primal-style. Shows the
            running total of verifiable zaps received next to the icon
            so a quick glance tells finders both 'this is the zap
            button' and 'this find has been zapped N sats'. Disabled
            when the finder shared no Lightning address. */}
        <TouchableOpacity
          style={[styles.logZapButton, !lud16 && styles.logZapButtonDisabled]}
          disabled={!lud16}
          onPress={() => {
            if (lud16) onZap(log, lud16, name);
          }}
          accessibilityState={{ disabled: !lud16 }}
          testID={`hunt-log-${log.id.slice(0, 8)}-zap`}
          accessibilityLabel={
            zapsReceivedSats > 0
              ? `Zap ${display} — ${zapsReceivedSats.toLocaleString()} sats zapped so far`
              : `Zap ${display}`
          }
        >
          <Zap
            size={16}
            color={colors.brandPink}
            fill={zapsReceivedSats > 0 ? colors.brandPink : 'transparent'}
            strokeWidth={2.5}
          />
          {zapsReceivedSats > 0 ? (
            <Text style={styles.logZapText} testID={`hunt-log-${log.id.slice(0, 8)}-zaps-received`}>
              {zapsReceivedSats.toLocaleString()}
            </Text>
          ) : null}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// -----------------------------------------------------------------------------
// Cache spec panel — replaces the cryptic "D1 / T1 / micro" pills with a
// labelled, visual breakdown so a first-time geocacher knows what they
// mean. NIP-GC scales are 1-5 for both difficulty (how tricky to find)
// and terrain (how rough the walk). Size + cache-type are categorical;
// we surface a one-line plain-English description for each.
// -----------------------------------------------------------------------------

const SIZE_LABELS: Record<string, { label: string; description: string }> = {
  micro: { label: 'Micro', description: 'Matchbox-sized' },
  small: { label: 'Small', description: 'Sandwich-box-sized' },
  regular: { label: 'Regular', description: 'Ammo-can-sized' },
  large: { label: 'Large', description: 'Bucket-sized' },
  other: { label: 'Other', description: 'Custom container' },
};

const TYPE_LABELS: Record<string, { label: string; description: string; Icon: typeof Box }> = {
  traditional: {
    label: 'Traditional',
    description: 'The coordinates are the cache',
    Icon: Box,
  },
  multi: {
    label: 'Multi',
    description: 'Visit multiple waypoints to find it',
    Icon: Boxes,
  },
  mystery: {
    label: 'Mystery',
    description: 'Solve a puzzle to learn the coordinates',
    Icon: HelpCircle,
  },
  virtual: {
    label: 'Virtual',
    description: 'No physical container; check in instead',
    Icon: Cloud,
  },
  event: {
    label: 'Event',
    description: 'A gathering at a time and place',
    Icon: CalendarDays,
  },
};

const DIFFICULTY_DESCRIPTIONS: Record<string, string> = {
  '1': 'Quick find',
  '2': 'Moderate find',
  '3': 'Challenging find',
  '4': 'Tricky find',
  '5': 'Very difficult',
};

const TERRAIN_DESCRIPTIONS: Record<string, string> = {
  '1': 'Easy walk',
  '2': 'Light walk',
  '3': 'Moderate hike',
  '4': 'Steep or rough',
  '5': 'Special gear needed',
};

type SpecOption = { label: string; description: string; isCurrent: boolean };

// Shared explanation payload — every chip and every D/T/S meter opens the
// same popup. `options`, when present, lists the full vocab for that field
// with the cache's current value highlighted.
type SpecInfo = { key: string; title: string; body: string; options?: SpecOption[] };

type SpecChip = SpecInfo & {
  label: string;
  Icon: typeof Box;
  // The Piglet chip stays bright pink so a payout cache reads at a glance;
  // every other chip is a neutral outline chip.
  accent?: boolean;
  iconColor?: string;
  iconFill?: string;
};

type SpecMeter = SpecInfo & {
  name: string;
  value: number;
};

// 5-segment level bar for difficulty / terrain / size.
const SegmentBar: React.FC<{ value: number; colors: Palette }> = ({ value, colors }) => (
  <View style={{ flexDirection: 'row', gap: 3 }}>
    {[1, 2, 3, 4, 5].map((i) => (
      <View
        key={i}
        style={{
          flex: 1,
          height: 6,
          borderRadius: 2,
          backgroundColor: i <= value ? colors.brandPink : colors.divider,
        }}
      />
    ))}
  </View>
);

const CacheSpecPanel: React.FC<{
  cache: ParsedCache;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ cache, colors, styles }) => {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const typeKey = (cache.cacheType ?? 'traditional').toLowerCase();
  const sizeKey = (cache.size ?? '').toLowerCase();
  const typeInfo = TYPE_LABELS[typeKey];
  const sizeInfo = SIZE_LABELS[sizeKey];

  const chips: SpecChip[] = [
    {
      key: 'kind',
      label: cache.isLpPiggy ? 'Piglet' : 'NIP-GC cache',
      title: cache.isLpPiggy ? 'Lightning Piggy' : 'NIP-GC geocache',
      body: cache.isLpPiggy
        ? 'A geocache with a Lightning payout. Tap its NFC tag (or scan its QR) at the cache to claim the sats.'
        : 'A standard geocache published by another NIP-GC client — no Lightning payout, just the find.',
      Icon: cache.isLpPiggy ? PiggyBank : MapPin,
      accent: cache.isLpPiggy,
      options: [
        {
          label: 'Lightning Piggy',
          description: 'Has a Lightning payout you claim at the cache.',
          isCurrent: cache.isLpPiggy,
        },
        {
          label: 'NIP-GC cache',
          description: 'A standard geocache — no payout, just the find.',
          isCurrent: !cache.isLpPiggy,
        },
      ],
    },
  ];

  if (cache.payoutSats != null) {
    chips.push({
      key: 'prize',
      label: `${cache.payoutSats.toLocaleString()} sats`,
      title: 'Prize',
      body: "The Lightning payout this Piggy was stocked with. Claim it by tapping the Piggy's NFC tag at the cache — the balance isn't guaranteed once other finders have claimed.",
      Icon: Zap,
      iconColor: colors.zapYellow,
      iconFill: colors.zapYellow,
    });
  }
  if (cache.waitSeconds != null) {
    chips.push({
      key: 'cooldown',
      label:
        cache.waitSeconds >= 3600
          ? `${Math.round(cache.waitSeconds / 3600)}h cooldown`
          : `${Math.round(cache.waitSeconds / 60)}m cooldown`,
      title: 'Cooldown',
      body: 'How long a finder must wait between claims on this Piggy.',
      Icon: Clock,
    });
  }
  if (cache.uses != null) {
    chips.push({
      key: 'uses',
      label: `${cache.uses.toLocaleString()} claims`,
      title: 'Total claims',
      body: 'How many times the prize can be claimed in all, across every finder.',
      Icon: Repeat,
    });
  }
  if (typeInfo) {
    chips.push({
      key: 'type',
      label: typeInfo.label,
      title: `Type · ${typeInfo.label}`,
      body: 'What style of geocache this is — how a finder reaches the coordinates.',
      Icon: typeInfo.Icon,
      options: Object.entries(TYPE_LABELS).map(([k, v]) => ({
        label: v.label,
        description: v.description,
        isCurrent: k === typeKey,
      })),
    });
  }

  // Always surface Difficulty / Terrain / Size, even when the cache didn't
  // specify them — an empty bar + "not set" reads clearer than the field
  // silently vanishing (and matches the hider being able to fill them in).
  const meters: SpecMeter[] = [
    {
      key: 'difficulty',
      name: 'Difficulty',
      value: cache.difficulty ?? 0,
      title: cache.difficulty ? `Difficulty ${cache.difficulty}/5` : 'Difficulty — not set',
      body: 'How tricky this cache is to find — rated 1 (quick) to 5 (very difficult) on the NIP-GC scale.',
      options: Object.entries(DIFFICULTY_DESCRIPTIONS).map(([level, desc]) => ({
        label: `Level ${level}`,
        description: desc,
        isCurrent: cache.difficulty != null && Number(level) === cache.difficulty,
      })),
    },
    {
      key: 'terrain',
      name: 'Terrain',
      value: cache.terrain ?? 0,
      title: cache.terrain ? `Terrain ${cache.terrain}/5` : 'Terrain — not set',
      body: 'How rough the journey to the cache is — rated 1 (easy walk) to 5 (special gear needed).',
      options: Object.entries(TERRAIN_DESCRIPTIONS).map(([level, desc]) => ({
        label: `Level ${level}`,
        description: desc,
        isCurrent: cache.terrain != null && Number(level) === cache.terrain,
      })),
    },
    {
      key: 'size',
      name: 'Size',
      value: sizeInfo ? Object.keys(SIZE_LABELS).indexOf(sizeKey) + 1 : 0,
      title: sizeInfo ? `Size · ${sizeInfo.label}` : 'Size — not set',
      body: 'Roughly how big the cache container is — from a matchbox to a bucket.',
      options: Object.entries(SIZE_LABELS).map(([k, v]) => ({
        label: v.label,
        description: v.description,
        isCurrent: k === sizeKey,
      })),
    },
  ];

  // Expiry — surfaced as a chip so the finder knows when the listing
  // will drop off relays. NIP-40 says relays SHOULD honour the
  // expiration tag; in practice every default relay we use does. An
  // already-expired listing reads as "Expired Nd ago" so a hunter who
  // hit a stale link knows it's not coming back without a republish.
  if (cache.expiresAt != null) {
    const nowSec = Math.floor(Date.now() / 1000);
    const daysLeft = Math.round((cache.expiresAt - nowSec) / 86400);
    const dateStr = new Date(cache.expiresAt * 1000).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const isExpired = daysLeft < 0;
    chips.push({
      key: 'expires',
      label: isExpired
        ? `Expired ${Math.abs(daysLeft)}d ago`
        : daysLeft < 60
          ? `Expires in ${daysLeft}d`
          : `Expires ${dateStr}`,
      title: isExpired ? 'Expired' : 'Listing expiry',
      body: isExpired
        ? `This listing was set to expire on ${dateStr}. Relays may have dropped it already, and the hider will need to republish to bring it back.`
        : `The hider set this listing to expire on ${dateStr} (NIP-40). After that, relays drop the event and the cache stops appearing in searches unless someone republishes it.`,
      Icon: Clock,
      iconColor: isExpired ? colors.red : undefined,
    });
  }

  const open: SpecInfo | null = [...chips, ...meters].find((x) => x.key === openKey) ?? null;

  return (
    <View testID="hunt-piggy-detail-spec-panel">
      <View style={styles.chipRow}>
        {chips.map((chip) => {
          const active = openKey === chip.key;
          return (
            <TouchableOpacity
              key={chip.key}
              style={[
                styles.chip,
                chip.accent && styles.chipAccent,
                active && !chip.accent && styles.chipActive,
              ]}
              onPress={() => setOpenKey(active ? null : chip.key)}
              testID={`hunt-piggy-detail-chip-${chip.key}`}
              accessibilityLabel={chip.title}
              accessibilityHint="Tap for an explanation"
            >
              <chip.Icon
                size={13}
                color={chip.accent ? colors.white : (chip.iconColor ?? colors.brandPink)}
                fill={chip.iconFill ?? 'none'}
                strokeWidth={2.5}
              />
              <Text style={[styles.chipText, chip.accent && styles.chipTextAccent]}>
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {meters.length > 0 ? (
        <View style={styles.meterRow}>
          {meters.map((meter) => {
            const active = openKey === meter.key;
            return (
              <TouchableOpacity
                key={meter.key}
                style={styles.meter}
                onPress={() => setOpenKey(active ? null : meter.key)}
                testID={`hunt-piggy-detail-meter-${meter.key}`}
                accessibilityLabel={meter.title}
                accessibilityHint="Tap for an explanation"
              >
                <Text style={[styles.meterName, active && styles.meterNameActive]}>
                  {meter.name}
                </Text>
                <SegmentBar value={meter.value} colors={colors} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      <CacheSpecSheet spec={open} onClose={() => setOpenKey(null)} />
    </View>
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
    body: { padding: 16, gap: 12 },
    errorText: { fontSize: 14, color: colors.brandPink, textAlign: 'center' },
    subtle: { fontSize: 13, color: colors.textSupplementary, lineHeight: 20 },
    heroWrap: { position: 'relative' },
    // Photo and map share one fixed-size hero slot so toggling between
    // them never shifts the layout.
    hero: {
      width: '100%',
      height: 200,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: colors.divider,
    },
    heroToggle: {
      position: 'absolute',
      top: 8,
      right: 8,
      flexDirection: 'row',
      gap: 4,
      padding: 4,
      borderRadius: 100,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    heroToggleBtn: {
      width: 42,
      height: 42,
      borderRadius: 100,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroToggleBtnActive: { backgroundColor: colors.brandPink },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 100,
    },
    chipAccent: { backgroundColor: colors.brandPink, borderColor: colors.brandPink },
    chipActive: { backgroundColor: colors.brandPinkLight, borderColor: colors.brandPink },
    chipText: { fontSize: 12, fontWeight: '700', color: colors.textHeader },
    chipTextAccent: { color: colors.white },
    // Full-bleed band — escapes the body's 16dp padding so the subtle
    // surface tint runs edge to edge, setting the D/T/S row apart from
    // the chips above and the action buttons below.
    meterRow: {
      flexDirection: 'row',
      gap: 22,
      marginHorizontal: -16,
      // No marginBottom — the body's 12dp gap already sits below, so a
      // marginBottom here would make the band float lower than its top.
      marginTop: 12,
      paddingHorizontal: 28,
      paddingVertical: 16,
      backgroundColor: colors.surface,
    },
    meter: { flex: 1, gap: 6 },
    meterName: { fontSize: 11, fontWeight: '700', color: colors.textSupplementary },
    meterNameActive: { color: colors.brandPink },
    metaPill: {
      backgroundColor: colors.surface,
      color: colors.textSupplementary,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 100,
      fontSize: 11,
      fontWeight: '600',
    },
    description: { fontSize: 14, color: colors.textHeader, lineHeight: 20 },
    attribution: {
      fontSize: 12,
      color: colors.textSupplementary,
      fontStyle: 'italic',
      marginTop: 2,
      lineHeight: 17,
    },
    hiderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 8,
      marginBottom: 4,
    },
    hiderAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
    },
    hiderAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    hiderAvatarInitial: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '800',
    },
    hiderName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    hiderHint: {
      fontSize: 11,
      color: colors.textSupplementary,
      fontStyle: 'italic',
      marginTop: 1,
    },
    logAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surface,
      marginRight: 8,
    },
    logZapButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.brandPink,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 999,
    },
    logZapButtonDisabled: { opacity: 0.4 },
    logZapText: {
      color: colors.brandPink,
      fontSize: 12,
      fontWeight: '700',
    },
    hintCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.brandPinkLight,
      padding: 12,
      borderRadius: 10,
    },
    hintText: { color: colors.brandPink, fontSize: 13, fontWeight: '600', flex: 1 },
    claimSection: { gap: 8 },
    actionRow: { flexDirection: 'row', gap: 10 },
    actionButtonPrimary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      borderRadius: 100,
    },
    actionButtonPrimaryText: { color: colors.white, fontSize: 15, fontWeight: '700' },
    actionButtonSecondary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.brandPink,
      paddingVertical: 14,
      borderRadius: 100,
    },
    actionButtonSecondaryText: { color: colors.brandPink, fontSize: 15, fontWeight: '700' },
    claimButtonDisabled: { opacity: 0.45 },
    claimNote: {
      color: colors.textSupplementary,
      fontSize: 12,
      lineHeight: 16,
      textAlign: 'center',
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
      marginTop: 12,
    },
    composer: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 10,
      marginTop: 8,
    },
    composerInput: {
      minHeight: 64,
      fontSize: 14,
      color: colors.textBody,
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 10,
    },
    composerPhotoPreviewWrap: { position: 'relative' },
    composerPhotoPreview: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 10,
      backgroundColor: colors.divider,
    },
    composerPhotoRemove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    composerPhotoButtons: { flexDirection: 'row', gap: 8 },
    composerPhotoButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.brandPinkLight,
    },
    composerPhotoButtonText: { color: colors.brandPink, fontSize: 13, fontWeight: '700' },
    composerHeader: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSupplementary,
      marginBottom: 6,
    },
    composerActions: { flexDirection: 'row', gap: 8 },
    composerPost: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.brandPink,
      paddingVertical: 12,
      borderRadius: 100,
    },
    // Always-on composer no longer has a Cancel button alongside Post,
    // so Post takes the full width of the actions row.
    composerPostFull: { flex: 1 },
    composerPostDim: { opacity: 0.6 },
    composerPostText: { color: colors.white, fontSize: 14, fontWeight: '700' },
    logRow: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      gap: 6,
      marginTop: 6,
    },
    logHeader: { flexDirection: 'row', alignItems: 'center' },
    logAuthor: { color: colors.textSupplementary, fontSize: 12, fontFamily: 'monospace' },
    logAge: { color: colors.textSupplementary, fontSize: 12 },
    logImage: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 8,
      backgroundColor: colors.divider,
    },
    logContent: { fontSize: 14, color: colors.textHeader, lineHeight: 20 },
    logFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    logBadgesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
    },
    logBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.brandPinkLight,
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 100,
    },
    logBadgeText: { color: colors.brandPink, fontSize: 11, fontWeight: '700' },
    logBadgeZapped: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.brandPink,
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 100,
    },
    logBadgeZappedText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  });

export default HuntPiggyDetailScreen;
