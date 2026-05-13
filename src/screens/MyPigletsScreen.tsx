import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronLeft, ChevronRight, MapPin, PiggyBank, Plus } from 'lucide-react-native';
import type { VerifiedEvent } from 'nostr-tools';
import { useThemeColors } from '../contexts/ThemeContext';
import { useNostr } from '../contexts/NostrContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { type ParsedCache, parseCacheCoord } from '../services/nostrPlacesService';
import { subscribeFoundLogsByAuthors } from '../services/nostrPlacesPublisher';
import { loadCachedCaches, peekCachedCachesSync } from '../services/nostrPlacesStorage';
import { ExploreNavigation } from '../navigation/types';
import type { Palette } from '../styles/palettes';

interface Props {
  navigation: ExploreNavigation;
}

// Parsed kind 7516 found-log keyed by the cache it refers to, kept
// flat so the SectionList renderer can render a single row regardless
// of which section it came from. coord is the `<kind>:<pubkey>:<d>`
// of the cache being claimed; finderPubkey is the author of the 7516.
type FoundEntry = {
  id: string;
  coord: string;
  finderPubkey: string;
  createdAt: number;
  amountSats: number | null;
  cache: ParsedCache | null;
};

const parseFoundEvent = (e: VerifiedEvent, cacheLookup: Map<string, ParsedCache>): FoundEntry => {
  const coordTag = e.tags.find((t) => t[0] === 'a')?.[1] ?? '';
  const amount = e.tags.find((t) => t[0] === 'amount')?.[1];
  const amountSats = amount ? Math.round(Number(amount) / 1000) || null : null;
  return {
    id: e.id,
    coord: coordTag,
    finderPubkey: e.pubkey,
    createdAt: e.created_at,
    amountSats,
    cache: cacheLookup.get(coordTag) ?? null,
  };
};

// Section row variants — `kind` discriminates which list it came from
// so the renderer can pick the right meta line + icon.
type SectionRow =
  | { kind: 'hidden'; cache: ParsedCache }
  | { kind: 'found'; entry: FoundEntry }
  | { kind: 'friend-found'; entry: FoundEntry };

const MyPigletsScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { pubkey } = useNostr();
  const { trustSet } = useTrustGraph();

  // Local NIP-GC cache — paint instantly, then refresh from AsyncStorage.
  const [allCaches, setAllCaches] = useState<ParsedCache[]>(() => peekCachedCachesSync());
  useEffect(() => {
    let cancelled = false;
    loadCachedCaches().then((cs) => {
      if (!cancelled && cs.length > 0) setAllCaches(cs);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Map for finds → cache lookup. Built once per allCaches change.
  const cacheByCoord = useMemo(() => {
    const m = new Map<string, ParsedCache>();
    for (const c of allCaches) m.set(c.coord, c);
    return m;
  }, [allCaches]);

  // Hidden — caches authored by me. Local-only; the listing was already
  // persisted by the same NIP-GC subscriber the Geo-caches page uses.
  const hidden = useMemo(() => {
    if (!pubkey) return [];
    const lower = pubkey.toLowerCase();
    return allCaches
      .filter((c) => c.hiderPubkey.toLowerCase() === lower)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [allCaches, pubkey]);

  // Found by me — kind 7516 authored by me.
  const [myFinds, setMyFinds] = useState<Map<string, FoundEntry>>(new Map());
  useEffect(() => {
    if (!pubkey) return undefined;
    setMyFinds(new Map());
    const close = subscribeFoundLogsByAuthors([pubkey], (e) => {
      const entry = parseFoundEvent(e, cacheByCoord);
      setMyFinds((prev) => {
        const next = new Map(prev);
        const existing = next.get(entry.coord);
        // Keep the most recent claim per cache so re-finds don't
        // duplicate rows. created_at is unix-seconds.
        if (!existing || entry.createdAt > existing.createdAt) next.set(entry.coord, entry);
        return next;
      });
    });
    return () => close();
  }, [pubkey, cacheByCoord]);

  // Friends' finds — kind 7516 authored by anyone in the trust set,
  // excluding me. `trustSet` includes the user per TrustGraphContext
  // docs, so we explicitly filter pubkey out.
  const trustedAuthors = useMemo(() => {
    if (!pubkey) return [];
    const lower = pubkey.toLowerCase();
    return Array.from(trustSet).filter((p) => p.toLowerCase() !== lower);
  }, [trustSet, pubkey]);

  const [friendFinds, setFriendFinds] = useState<Map<string, FoundEntry>>(new Map());
  useEffect(() => {
    setFriendFinds(new Map());
    if (trustedAuthors.length === 0) return undefined;
    const close = subscribeFoundLogsByAuthors(trustedAuthors, (e) => {
      const entry = parseFoundEvent(e, cacheByCoord);
      setFriendFinds((prev) => {
        // Key on event id — multiple friends finding the same cache
        // should each get a row. (My-finds dedupes per-cache; here we
        // want the social signal.)
        if (prev.has(entry.id)) return prev;
        const next = new Map(prev);
        next.set(entry.id, entry);
        return next;
      });
    });
    return () => close();
  }, [trustedAuthors, cacheByCoord]);

  const foundList = useMemo(
    () => [...myFinds.values()].sort((a, b) => b.createdAt - a.createdAt),
    [myFinds],
  );
  const friendList = useMemo(
    () => [...friendFinds.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50),
    [friendFinds],
  );

  const sections: { title: string; data: SectionRow[] }[] = useMemo(
    () => [
      {
        title: `Hidden${hidden.length > 0 ? ` · ${hidden.length}` : ''}`,
        data: hidden.map((c) => ({ kind: 'hidden' as const, cache: c })),
      },
      {
        title: `Found${foundList.length > 0 ? ` · ${foundList.length}` : ''}`,
        data: foundList.map((e) => ({ kind: 'found' as const, entry: e })),
      },
      {
        title: `Friends' finds${friendList.length > 0 ? ` · ${friendList.length}` : ''}`,
        data: friendList.map((e) => ({ kind: 'friend-found' as const, entry: e })),
      },
    ],
    [hidden, foundList, friendList],
  );

  const openCacheByCoord = (coord: string) => {
    if (!coord) return;
    if (!parseCacheCoord(coord)) return;
    navigation.navigate('HuntPiggyDetail', { coord });
  };

  return (
    <View style={styles.container} testID="my-piglets-screen">
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
            accessibilityLabel="Back"
            testID="my-piglets-back-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Piglets</Text>
          <View style={{ width: 24 }} />
        </View>
        <Text style={styles.headerTagline}>
          What you&apos;ve hidden, found, and what your friends are claiming
        </Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) =>
          item.kind === 'hidden' ? `h:${item.cache.coord}` : `${item.kind}:${item.entry.id}`
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.hideCta}
            onPress={() => navigation.navigate('HuntCreate')}
            accessibilityLabel="Hide a Piglet"
            testID="my-piglets-hide-cta"
          >
            <Plus size={20} color={colors.white} strokeWidth={2.5} />
            <Text style={styles.hideCtaText}>Hide a Piglet</Text>
          </TouchableOpacity>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <Text style={styles.emptySection}>{emptyTextFor(section.title)}</Text>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'hidden') {
            return (
              <Row
                cache={item.cache}
                meta={`Piglet · D${item.cache.difficulty ?? '?'} / T${item.cache.terrain ?? '?'}`}
                colors={colors}
                styles={styles}
                onPress={() => openCacheByCoord(item.cache.coord)}
                testID={`my-piglets-hidden-${item.cache.d}`}
              />
            );
          }
          const entry = item.entry;
          const meta =
            (entry.amountSats ? `⚡ ${entry.amountSats} sats` : 'Found') +
            (entry.cache?.name ? ` · ${entry.cache.name}` : '');
          return (
            <Row
              cache={entry.cache}
              meta={meta}
              colors={colors}
              styles={styles}
              onPress={() => openCacheByCoord(entry.coord)}
              testID={`my-piglets-${item.kind}-${entry.id.slice(0, 8)}`}
            />
          );
        }}
        ListFooterComponent={
          !pubkey ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brandPink} />
            </View>
          ) : null
        }
      />
    </View>
  );
};

const emptyTextFor = (title: string): string => {
  if (title.startsWith('Hidden'))
    return 'You haven’t hidden a Piglet yet. Tap "Hide a Piglet" to set one up.';
  if (title.startsWith('Found'))
    return 'No finds yet — claim a Piglet on the Geo-caches page and it’ll show up here.';
  return 'No friends have claimed a Piglet yet. Their finds show up here as they happen.';
};

interface RowProps {
  cache: ParsedCache | null;
  meta: string;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
  testID: string;
}

const Row: React.FC<RowProps> = ({ cache, meta, colors, styles, onPress, testID }) => (
  <TouchableOpacity
    style={styles.row}
    onPress={onPress}
    testID={testID}
    accessibilityLabel={cache?.name ?? meta}
  >
    {cache?.imageUrl ? (
      <Image source={{ uri: cache.imageUrl }} style={styles.thumb} resizeMode="cover" />
    ) : (
      <View
        style={[styles.iconWrap, cache?.isLpPiggy === false ? styles.iconStandard : styles.iconLp]}
      >
        {cache?.isLpPiggy === false ? (
          <MapPin size={22} color={colors.white} strokeWidth={2} />
        ) : (
          <PiggyBank size={22} color={colors.white} strokeWidth={2} />
        )}
      </View>
    )}
    <View style={styles.rowMain}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {cache?.name ?? 'Cache no longer on relays'}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {meta}
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
    headerImage: { ...StyleSheet.absoluteFillObject },
    headerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(236, 0, 140, 0.65)',
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
    listContent: { paddingBottom: 32 },
    hideCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      marginHorizontal: 16,
      marginTop: 14,
      marginBottom: 18,
      borderRadius: 100,
      paddingVertical: 14,
    },
    hideCtaText: { color: colors.white, fontSize: 15, fontWeight: '700' },
    sectionHeader: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.textSupplementary,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginHorizontal: 16,
      marginTop: 18,
      marginBottom: 8,
    },
    emptySection: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginHorizontal: 16,
      marginBottom: 4,
      lineHeight: 19,
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
    iconStandard: { backgroundColor: colors.textSupplementary },
    thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.divider },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '700', color: colors.textHeader },
    rowMeta: { fontSize: 12, color: colors.textSupplementary, marginTop: 2 },
    center: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  });

export default MyPigletsScreen;
