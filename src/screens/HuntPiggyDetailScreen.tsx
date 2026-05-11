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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  Eye,
  EyeOff,
  ImagePlus,
  MapPin,
  PiggyBank,
  Send,
  Sparkles,
  X,
} from 'lucide-react-native';
import type { RouteProp } from '@react-navigation/native';
import type { VerifiedEvent } from 'nostr-tools';
import { useThemeColors } from '../contexts/ThemeContext';
import { useNostr } from '../contexts/NostrContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import { buildFoundLog, parseCacheCoord, type ParsedCache } from '../services/nostrPlacesService';
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
  const [hasClaimed, setHasClaimed] = useState(false);
  const closerRef = useRef<(() => void) | null>(null);

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
    closerRef.current = closer;
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
      // ANY Piggy in the last hour. Refine in M8.
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
            {cache.imageUrl ? (
              <Image source={{ uri: cache.imageUrl }} style={styles.heroImage} resizeMode="cover" />
            ) : null}
            <View style={styles.kindRow}>
              {cache.isLpPiggy ? (
                <View style={styles.lpBadge}>
                  <PiggyBank size={14} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.lpBadgeText}>Piglet</Text>
                </View>
              ) : (
                <View style={styles.standardBadge}>
                  <MapPin size={14} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.lpBadgeText}>NIP-GC cache</Text>
                </View>
              )}
              {cache.cacheType ? <Text style={styles.metaPill}>{cache.cacheType}</Text> : null}
              {cache.size ? <Text style={styles.metaPill}>{cache.size}</Text> : null}
              {cache.difficulty ? <Text style={styles.metaPill}>D{cache.difficulty}</Text> : null}
              {cache.terrain ? <Text style={styles.metaPill}>T{cache.terrain}</Text> : null}
            </View>
            <Text style={styles.description}>{cache.description}</Text>
            {/* Attribution — surface the hider so the finder knows
                whose word they're trusting before walking to a
                coordinate. The npub is shorthand-formatted; full
                profile UI lands later. The WoT filter would already
                have hidden this listing from any view if the hider
                weren't in the user's trust graph (see
                `trustGraphService` for the threat model). */}
            <Text style={styles.attribution} testID="hunt-piggy-detail-attribution">
              Hidden by {cache.hiderPubkey.slice(0, 8)}…{cache.hiderPubkey.slice(-4)} — verify you
              trust them before going to the location.
            </Text>
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
            {cache.isLpPiggy ? (
              <View style={styles.tapHintCard}>
                <Sparkles size={14} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.tapHintText}>
                  Tap the physical NFC tag or scan the QR at the cache to claim sats.
                </Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Find log ({sortedLogs.length})</Text>
            {sortedLogs.length === 0 ? (
              <Text style={styles.subtle}>
                No finds logged yet. {hasClaimed ? 'Be the first to drop a log entry!' : ''}
              </Text>
            ) : (
              sortedLogs.map((log) => (
                <LogRow key={log.id} log={log} colors={colors} styles={styles} />
              ))
            )}

            {hasClaimed && !composerOpen ? (
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
    </View>
  );
};

const LogRow: React.FC<{
  log: FoundLog;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ log, colors, styles }) => {
  const ageMins = Math.floor((Date.now() / 1000 - log.createdAt) / 60);
  const ageLabel =
    ageMins < 60
      ? `${ageMins}m ago`
      : ageMins < 60 * 24
        ? `${Math.floor(ageMins / 60)}h ago`
        : `${Math.floor(ageMins / (60 * 24))}d ago`;
  return (
    <View style={styles.logRow} testID={`hunt-log-${log.id.slice(0, 8)}`}>
      <View style={styles.logHeader}>
        <Text style={styles.logAuthor}>{log.pubkey.slice(0, 12)}…</Text>
        <Text style={styles.logAge}>{ageLabel}</Text>
      </View>
      {log.imageUrl ? (
        <Image source={{ uri: log.imageUrl }} style={styles.logImage} resizeMode="cover" />
      ) : null}
      <Text style={styles.logContent}>{log.content}</Text>
      {log.amountSats ? (
        <View style={styles.logBadge}>
          <CheckCircle2 size={12} color={colors.brandPink} strokeWidth={2.5} />
          <Text style={styles.logBadgeText}>⚡ claimed {log.amountSats} sats</Text>
        </View>
      ) : null}
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
    heroImage: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 12,
      backgroundColor: colors.divider,
    },
    kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
    lpBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    standardBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.textSupplementary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    lpBadgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
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
    hintCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.brandPinkLight,
      padding: 12,
      borderRadius: 10,
    },
    hintText: { color: colors.brandPink, fontSize: 13, fontWeight: '600', flex: 1 },
    tapHintCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.brandPinkLight,
    },
    tapHintText: { color: colors.textHeader, fontSize: 13, flex: 1, lineHeight: 18 },
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
    logHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    logAuthor: { color: colors.textSupplementary, fontSize: 12, fontFamily: 'monospace' },
    logAge: { color: colors.textSupplementary, fontSize: 12 },
    logImage: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 8,
      backgroundColor: colors.divider,
    },
    logContent: { fontSize: 14, color: colors.textHeader, lineHeight: 20 },
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
