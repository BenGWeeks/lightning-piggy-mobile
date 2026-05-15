import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  TextInput,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  Boxes,
  Box,
  Camera,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Cloud,
  Eye,
  EyeOff,
  HelpCircle,
  ImagePlus,
  MapPin,
  Navigation,
  PiggyBank,
  Repeat,
  Send,
  Sparkles,
  User,
  X,
  Zap,
} from 'lucide-react-native';
import type { RouteProp } from '@react-navigation/native';
import type { VerifiedEvent } from 'nostr-tools';
import { useThemeColors } from '../contexts/ThemeContext';
import { useNostr } from '../contexts/NostrContext';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import ContactProfileSheet from '../components/ContactProfileSheet';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import { buildFoundLog, parseCacheCoord, type ParsedCache } from '../services/nostrPlacesService';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import CacheSpecSheet from '../components/CacheSpecSheet';
import { decodeGeohash, formatDistance } from '../utils/geohash';
import { useCompassNavigation } from '../hooks/useCompassNavigation';
import {
  fetchCache,
  publishCacheEvent,
  subscribeFoundLogs,
} from '../services/nostrPlacesPublisher';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';
import { lastClaimFor } from '../services/claimHistoryService';

interface Props {
  navigation: ExploreNavigation;
  route: RouteProp<ExploreStackParamList, 'HuntPiggyDetail'>;
}

type FoundLog = {
  id: string;
  pubkey: string;
  createdAt: number;
  content: string;
  imageUrl: string | null;
  amountSats: number | null;
};

const parseFoundLog = (e: VerifiedEvent): FoundLog => {
  const tag = (k: string): string | undefined => e.tags.find((t) => t[0] === k)?.[1];
  const amt = parseInt(tag('amount') ?? '', 10);
  return {
    id: e.id,
    pubkey: e.pubkey,
    createdAt: e.created_at,
    content: e.content,
    imageUrl: tag('image') ?? null,
    amountSats: Number.isFinite(amt) && amt > 0 ? amt : null,
  };
};

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
  const { coord } = route.params;
  const { signEvent, relays } = useNostr();

  const [cache, setCache] = useState<ParsedCache | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Map<string, FoundLog>>(new Map());
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerPhotoUrl, setComposerPhotoUrl] = useState<string | null>(null);
  const [composerUploading, setComposerUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  // Hints are ROT13-encoded on-relay per NIP-GC convention so generic
  // clients can't accidentally spoiler the find. We decode at parse
  // time but only reveal in the UI when the hunter explicitly taps —
  // that preserves the "stuck? unhide" experience geocachers expect.
  const [hintRevealed, setHintRevealed] = useState(false);
  // Reusable contact profile bottom sheet — opened when the user taps
  // the hider's row at the top of the screen or any find-log row.
  const [profileSheet, setProfileSheet] = useState<{
    pubkey: string;
    name: string;
    picture: string | null;
    lightningAddress: string | null;
  } | null>(null);
  const openProfileSheet = useCallback(
    (pubkey: string, name: string | null, picture: string | null, lud16: string | null) => {
      setProfileSheet({
        pubkey,
        name: name ?? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`,
        picture,
        lightningAddress: lud16,
      });
    },
    [],
  );
  const [hasClaimed, setHasClaimed] = useState(false);
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
  const { user: userPos, heading, bearing, distanceMetres } = useCompassNavigation(compassTarget);
  // lucide's Navigation glyph sits at ~45° at rest (the apex points up-
  // right). Subtract 45° from the desired rotation so the apex ends up
  // pointing toward the cache. Heading subtracted so the arrow stays
  // relative to where the phone is facing, not absolute North.
  const arrowRotation = bearing !== null && heading !== null ? bearing - heading - 45 : null;

  // ----- load listing + subscribe found-logs ------------------------------

  useEffect(() => {
    let cancelled = false;
    const parts = parseCacheCoord(coord);
    if (!parts) {
      setError('Invalid cache coordinate.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const c = await fetchCache(parts.pubkey, parts.d);
        if (cancelled) return;
        if (!c) {
          setError('Cache not found on relays — it may have expired.');
        } else {
          setCache(c);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const closer = subscribeFoundLogs(coord, (event) => {
      const log = parseFoundLog(event);
      setLogs((prev) => {
        if (prev.has(log.id)) return prev;
        const next = new Map(prev);
        next.set(log.id, log);
        return next;
      });
    });
    return () => {
      cancelled = true;
      closer();
    };
  }, [coord]);

  // ----- claim-history check (drives the post-find compose CTA) ----------

  useEffect(() => {
    if (!cache?.isLpPiggy) return;
    let cancelled = false;
    // Soft-claim signal: any local claim within the last 24h surfaces
    // the "Drop a log" CTA. We look up by every g tag's geohash since
    // we don't store a direct cache↔lnurl mapping locally — but for v1
    // we just check the local history for ANY claim inside the cache's
    // 5-char geohash radius. The result is permissive (false positives
    // are fine, the UX is "you've been near a cache, post a log").
    (async () => {
      // Simpler heuristic for now: assume the claim was recorded against
      // the same lnurl we'd see from this cache's physical tag — which we
      // don't have. Just enable the composer for any user who's claimed
      // ANY Piggy in the last 24 h. Refine in M8.
      const recent = await lastClaimFor(coord);
      if (!cancelled && recent && Date.now() / 1000 - recent.claimedAt < 24 * 60 * 60) {
        setHasClaimed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cache, coord]);

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
      const claim = await lastClaimFor(coord);
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
      setComposerOpen(false);
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

  // LP Piggies gate find-logging behind a successful claim (proof of
  // presence); plain NIP-GC caches have no claim step, so anyone can log.
  const canLog = hasClaimed || (cache != null && !cache.isLpPiggy);

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
    <View style={styles.container} testID="hunt-piggy-detail-screen">
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
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
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
                    <ExploreMiniMap
                      fill
                      cachePin
                      lat={decodeGeohash(cache.geohash).lat}
                      lon={decodeGeohash(cache.geohash).lng}
                      userLat={userPos?.lat ?? null}
                      userLon={userPos?.lon ?? null}
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
                  <Navigation
                    size={18}
                    color={colors.brandPink}
                    strokeWidth={2.5}
                    style={
                      arrowRotation !== null
                        ? { transform: [{ rotate: `${arrowRotation}deg` }] }
                        : undefined
                    }
                  />
                  <Text style={styles.actionButtonSecondaryText}>
                    {distanceMetres !== null
                      ? `Navigate · ${formatDistance(distanceMetres)}`
                      : 'Navigate'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButtonPrimary, !canLog && styles.claimButtonDisabled]}
                  disabled={!canLog}
                  onPress={() => setComposerOpen(true)}
                  accessibilityState={{ disabled: !canLog }}
                  accessibilityLabel={
                    canLog
                      ? 'Claim found — log your find'
                      : 'Claim found — scan the Piglet to unlock'
                  }
                  testID="hunt-piggy-detail-claim-button"
                >
                  <CheckCircle2 size={18} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.actionButtonPrimaryText}>Claim found</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.claimNote}>
                {!cache.isLpPiggy
                  ? 'Found this cache? Tap Claim found to log it for other hunters.'
                  : hasClaimed
                    ? 'Sats received! Log your find so other hunters can see it.'
                    : "Scan the Piglet's NFC tag (or its QR) at the cache to unlock Claim found."}
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
                />
              ))
            )}

            {canLog && !composerOpen ? (
              <TouchableOpacity
                style={styles.composeCta}
                onPress={() => setComposerOpen(true)}
                testID="hunt-piggy-detail-compose-button"
              >
                <Sparkles size={16} color={colors.white} strokeWidth={2.5} />
                <Text style={styles.composeCtaText}>Drop a log entry</Text>
              </TouchableOpacity>
            ) : null}

            {composerOpen ? (
              <View style={styles.composer}>
                <TextInput
                  style={styles.composerInput}
                  placeholder="Found it! Tucked behind the bench, cleverly hidden."
                  placeholderTextColor={colors.textSupplementary}
                  value={composerText}
                  onChangeText={setComposerText}
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
                    style={styles.composerCancel}
                    onPress={() => setComposerOpen(false)}
                  >
                    <Text style={styles.composerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.composerPost, posting && styles.composerPostDim]}
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
        visible={profileSheet !== null}
        onClose={() => setProfileSheet(null)}
        contact={
          profileSheet
            ? {
                pubkey: profileSheet.pubkey,
                name: profileSheet.name,
                picture: profileSheet.picture,
                lightningAddress: profileSheet.lightningAddress,
                source: 'nostr',
              }
            : null
        }
        onZap={
          profileSheet?.lightningAddress
            ? () => {
                const lud16 = profileSheet.lightningAddress!;
                setProfileSheet(null);
                Linking.openURL(`lightning:${lud16}`).catch(() => {});
              }
            : undefined
        }
      />
    </View>
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
  const display = name ?? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
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
}> = ({ log, colors, styles, onPressProfile }) => {
  const { name, picture, lud16 } = usePubkeyProfile(log.pubkey);
  const display = name ?? `${log.pubkey.slice(0, 8)}…${log.pubkey.slice(-4)}`;
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
        {/* Outline zap pill under the note so a hider can thank any
            finder; disabled when the finder shared no Lightning address. */}
        <TouchableOpacity
          style={[styles.logZapButton, !lud16 && styles.logZapButtonDisabled]}
          disabled={!lud16}
          onPress={() => {
            // Open the OS Lightning handler with the finder's LN address
            // pre-filled. Full in-app zap UX (NIP-57) lands in a follow-up
            // — for now we hand off to the user's default wallet.
            if (lud16) Linking.openURL(`lightning:${lud16}`).catch(() => {});
          }}
          accessibilityState={{ disabled: !lud16 }}
          testID={`hunt-log-${log.id.slice(0, 8)}-zap`}
          accessibilityLabel={`Zap ${display}`}
        >
          <Zap size={14} color={colors.brandPink} strokeWidth={2.5} />
          <Text style={styles.logZapText}>Zap</Text>
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

  const meters: SpecMeter[] = [];
  if (cache.difficulty) {
    meters.push({
      key: 'difficulty',
      name: 'Difficulty',
      value: cache.difficulty,
      title: `Difficulty ${cache.difficulty}/5`,
      body: 'How tricky this cache is to find — rated 1 (quick) to 5 (very difficult) on the NIP-GC scale.',
      options: Object.entries(DIFFICULTY_DESCRIPTIONS).map(([level, desc]) => ({
        label: `Level ${level}`,
        description: desc,
        isCurrent: Number(level) === cache.difficulty,
      })),
    });
  }
  if (cache.terrain) {
    meters.push({
      key: 'terrain',
      name: 'Terrain',
      value: cache.terrain,
      title: `Terrain ${cache.terrain}/5`,
      body: 'How rough the journey to the cache is — rated 1 (easy walk) to 5 (special gear needed).',
      options: Object.entries(TERRAIN_DESCRIPTIONS).map(([level, desc]) => ({
        label: `Level ${level}`,
        description: desc,
        isCurrent: Number(level) === cache.terrain,
      })),
    });
  }
  if (sizeInfo) {
    meters.push({
      key: 'size',
      name: 'Size',
      value: Object.keys(SIZE_LABELS).indexOf(sizeKey) + 1,
      title: `Size · ${sizeInfo.label}`,
      body: 'Roughly how big the cache container is — from a matchbox to a bucket.',
      options: Object.entries(SIZE_LABELS).map(([k, v]) => ({
        label: v.label,
        description: v.description,
        isCurrent: k === sizeKey,
      })),
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
    composeCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      borderRadius: 100,
      marginTop: 12,
    },
    composeCtaText: { color: colors.white, fontSize: 14, fontWeight: '700' },
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
    composerActions: { flexDirection: 'row', gap: 8 },
    composerCancel: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composerCancelText: { color: colors.textSupplementary, fontSize: 14, fontWeight: '700' },
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
  });

export default HuntPiggyDetailScreen;
