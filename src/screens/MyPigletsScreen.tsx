import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronLeft, ChevronRight, MapPin, PiggyBank, Plus, RotateCw } from 'lucide-react-native';
import type { VerifiedEvent } from 'nostr-tools';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { LpPayoutBadge } from '../components/LpPayoutBadge';
import BrandPatternBackground from '../components/BrandPatternBackground';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { t } from '../i18n';
import { useNostr } from '../contexts/NostrContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { type ParsedCache, parseCacheCoord } from '../services/nostrPlacesService';
import { useCoalescedMap } from '../utils/useCoalescedMap';
import { fetchCachesByAuthor, subscribeFoundLogsByAuthors } from '../services/nostrPlacesPublisher';
import { loadCachedCaches, peekCachedCachesSync } from '../services/nostrPlacesStorage';
import { loadPiggies, type HiddenPiggy } from '../services/piggyStorageService';
import { mergeHiddenWithDrafts, type HiddenRow } from '../utils/piggyToParsedCache';
import { republishPiggy } from '../services/republishPiggyService';
import { ExploreNavigation } from '../navigation/types';
import type { Palette } from '../styles/palettes';

interface Props {
  navigation: ExploreNavigation;
}

// Parsed kind 7516 found-log, flat shape so the SectionList renderer
// can render a single row regardless of which section it came from.
// `coord` is the `<kind>:<pubkey>:<d>` of the cache being claimed;
// `finderPubkey` is the author of the 7516. The Maps that hold these
// entries are keyed differently per section: `myFinds` keys by coord
// (most-recent claim per cache), `friendFinds` keys by event id (so
// multiple friends finding the same cache each get a social-feed
// row). See the comments on those two state hooks below.
//
// Deliberately does NOT embed the matching ParsedCache — the render
// path looks that up on demand via `cacheByCoord`. Earlier the entry
// carried `cache: ParsedCache | null`, which forced both the my-finds
// and friends'-finds subscribe effects to depend on `cacheByCoord`.
// Every `allCaches` refresh (relay echo, fetchCachesByAuthor result,
// mergeCaches tick) rebuilt that Map, restarted the sub, and the
// `setFriendFinds(new Map())` reset at the top of the effect blanked
// the section before it re-populated — a visible flicker. Keep the
// event data pure and let the render layer enrich it.
type FoundEntry = {
  id: string;
  coord: string;
  finderPubkey: string;
  createdAt: number;
  amountSats: number | null;
};

const parseFoundEvent = (e: VerifiedEvent): FoundEntry => {
  const coordTag = e.tags.find((t) => t[0] === 'a')?.[1] ?? '';
  const amount = e.tags.find((t) => t[0] === 'amount')?.[1];
  const amountSats = amount ? Math.round(Number(amount) / 1000) || null : null;
  return {
    id: e.id,
    coord: coordTag,
    finderPubkey: e.pubkey,
    createdAt: e.created_at,
    amountSats,
  };
};

// Section row variants — `kind` discriminates which list it came from
// so the renderer can pick the right meta line + icon.
type SectionRow =
  | { kind: 'hidden'; cache: ParsedCache; isDraft: boolean }
  | { kind: 'found'; entry: FoundEntry }
  | { kind: 'friend-found'; entry: FoundEntry };

const MyPigletsScreen: React.FC<Props> = ({ navigation }) => {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { pubkey, signEvent, relays } = useNostr();
  const { trustSet } = useTrustGraph();

  // Local-only `HiddenPiggy` records (LNURL bearer + original expiry
  // window). Needed by the Republish action — relays don't carry the
  // LNURL so we can't reconstruct it from a ParsedCache. Keyed by
  // `piggy.id` which equals the cache's `d` tag at publish time.
  const [piggiesById, setPiggiesById] = useState<Map<string, HiddenPiggy>>(new Map());
  useEffect(() => {
    let cancelled = false;
    loadPiggies().then((list) => {
      if (cancelled) return;
      const m = new Map<string, HiddenPiggy>();
      for (const p of list) m.set(p.id, p);
      setPiggiesById(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tracks which row is currently mid-republish so we can render a
  // spinner in place of the badge and ignore double-taps. Keyed by
  // cache coord.
  const [republishingCoord, setRepublishingCoord] = useState<string | null>(null);

  // Local NIP-GC cache — paint instantly, then refresh from AsyncStorage,
  // then ALSO query relays for the user's own kind 37516 listings by
  // author so historical Piggies surface even when (a) the nearby
  // subscription hasn't echoed them back, (b) the geohash sits outside
  // the user's current "nearby" window, or (c) this device's
  // ParsedCache store predates the publish. Three-layer hydrate keeps
  // the page useful regardless of cache freshness (#73 follow-up).
  const [allCaches, setAllCaches] = useState<ParsedCache[]>(() => peekCachedCachesSync());
  // Merge helper used by mount, refresh, and the by-author fetch —
  // dedupe by coord, latest createdAt wins.
  const mergeCaches = useCallback((incoming: ParsedCache[]) => {
    setAllCaches((prev) => {
      const merged = new Map<string, ParsedCache>();
      for (const c of prev) merged.set(c.coord, c);
      for (const c of incoming) {
        const existing = merged.get(c.coord);
        if (!existing || c.createdAt > existing.createdAt) merged.set(c.coord, c);
      }
      return [...merged.values()];
    });
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadCachedCaches().then((cs) => {
      if (!cancelled && cs.length > 0) mergeCaches(cs);
    });
    return () => {
      cancelled = true;
    };
  }, [mergeCaches]);
  // Relay fetch — only when we know the user's pubkey. The empty-deps
  // guard `lastFetchPubkeyRef` keeps this to one query per pubkey,
  // not per render.
  const lastFetchPubkeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pubkey || lastFetchPubkeyRef.current === pubkey) return;
    lastFetchPubkeyRef.current = pubkey;
    let cancelled = false;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    fetchCachesByAuthor(pubkey, readRelays.length > 0 ? readRelays : undefined)
      .then((mine) => {
        if (cancelled || mine.length === 0) return;
        mergeCaches(mine);
      })
      .catch(() => {
        // Non-fatal — the local cache still drives the page.
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey, relays, mergeCaches]);

  // Pull-to-refresh: re-hydrate both the local HiddenPiggy storage
  // (catches anything published since first mount) AND the relay-
  // sourced ParsedCache cache (catches kind 37516 echoes that
  // arrived while the Explore subscription was paused). Both reads
  // are sub-100 ms on a warm device; the brief refresh spinner is
  // the user-visible signal that the page is re-syncing.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const [piggies, caches, mine] = await Promise.all([
        loadPiggies(),
        loadCachedCaches(),
        pubkey
          ? fetchCachesByAuthor(pubkey, readRelays.length > 0 ? readRelays : undefined).catch(
              () => [] as ParsedCache[],
            )
          : Promise.resolve([] as ParsedCache[]),
      ]);
      const m = new Map<string, HiddenPiggy>();
      for (const p of piggies) m.set(p.id, p);
      setPiggiesById(m);
      mergeCaches([...caches, ...mine]);
    } finally {
      setRefreshing(false);
    }
  }, [mergeCaches, pubkey, relays]);

  // Map for finds → cache lookup. Built once per allCaches change.
  const cacheByCoord = useMemo(() => {
    const m = new Map<string, ParsedCache>();
    for (const c of allCaches) m.set(c.coord, c);
    return m;
  }, [allCaches]);

  // Hidden — the UNION of (a) relay/cache-sourced caches authored by me
  // and (b) local-only draft `HiddenPiggy` records that were saved with
  // the Public toggle off and so never got a published `ParsedCache`
  // twin. Deduped by coord (a published cache wins over its draft), so a
  // draft surfaces immediately and stops duplicating once published
  // (#909). Without the draft union, an unpublished Piglet is invisible
  // and looks lost even though it's safe in SecureStore.
  const hidden = useMemo<HiddenRow[]>(() => {
    if (!pubkey) return [];
    return mergeHiddenWithDrafts(allCaches, [...piggiesById.values()], pubkey);
  }, [allCaches, piggiesById, pubkey]);

  // Found by me — kind 7516 authored by me. CoalescedMap batches the
  // per-event `new Map(prev)` clones that otherwise cause O(N²) overhead
  // when the relay backfills 50+ found logs in a burst.
  const myFinds = useCoalescedMap<FoundEntry>({
    shouldReplace: (existing, incoming) => incoming.createdAt > existing.createdAt,
  });
  useEffect(() => {
    if (!pubkey) return undefined;
    myFinds.reset();
    const close = subscribeFoundLogsByAuthors([pubkey], (e) => {
      const entry = parseFoundEvent(e);
      myFinds.enqueue(entry.coord, entry);
    });
    return () => {
      close();
      myFinds.flush();
    };
    // myFinds.reset / enqueue / flush are stable callbacks (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  // Friends' finds — kind 7516 authored by anyone in the trust set,
  // excluding me. `trustSet` includes the user per TrustGraphContext
  // docs, so we explicitly filter pubkey out.
  const trustedAuthors = useMemo(() => {
    if (!pubkey) return [];
    const lower = pubkey.toLowerCase();
    return Array.from(trustSet).filter((p) => p.toLowerCase() !== lower);
  }, [trustSet, pubkey]);

  // Friends' finds — batched with CoalescedMap so a burst of kind 7516
  // events doesn't clone the friend-finds Map N times. Keyed by event id
  // (never replaced) so the key space is unbounded — and the subscription
  // sets no `limit` of its own, so this cap is what bounds growth: it stops
  // relay history over a long session from ballooning the Map (and the
  // sort-then-slice-50 in `friendList`). 200 keeps a comfortable buffer above
  // the 50 shown.
  const friendFinds = useCoalescedMap<FoundEntry>({
    // Keyed by event id per the social-feed convention — never replace.
    shouldReplace: () => false,
    maxSize: 200,
  });
  useEffect(() => {
    friendFinds.reset();
    if (trustedAuthors.length === 0) return undefined;
    const close = subscribeFoundLogsByAuthors(trustedAuthors, (e) => {
      const entry = parseFoundEvent(e);
      friendFinds.enqueue(entry.id, entry);
    });
    return () => {
      close();
      friendFinds.flush();
    };
    // friendFinds.reset / enqueue / flush are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trustedAuthors]);

  const foundList = useMemo(
    () => [...myFinds.map.values()].sort((a, b) => b.createdAt - a.createdAt),
    [myFinds.map],
  );
  // Drop find-logs whose cache event hasn't reached local storage —
  // showing "Cache no longer on relays" for every one looks broken to
  // the user even though it's a real state. They'll surface once the
  // cache subscription backfills. The filter recomputes when
  // `cacheByCoord` grows, so an entry that the relay sub hadn't
  // resolved yet appears once the matching kind 37516 lands — without
  // having to restart the find-log subscription.
  const friendList = useMemo(
    () =>
      [...friendFinds.map.values()]
        .filter((e) => cacheByCoord.has(e.coord))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50),
    [friendFinds.map, cacheByCoord],
  );

  const sections: { id: string; title: string; data: SectionRow[] }[] = useMemo(
    () => [
      {
        id: 'hidden',
        title: `${t('myPigletsScreen.sectionHidden')}${hidden.length > 0 ? ` · ${hidden.length}` : ''}`,
        data: hidden.map((r) => ({ kind: 'hidden' as const, cache: r.cache, isDraft: r.isDraft })),
      },
      {
        id: 'found',
        title: `${t('myPigletsScreen.sectionFound')}${foundList.length > 0 ? ` · ${foundList.length}` : ''}`,
        data: foundList.map((e) => ({ kind: 'found' as const, entry: e })),
      },
      {
        id: 'friends',
        title: `${t('myPigletsScreen.sectionFriendsFinds')}${friendList.length > 0 ? ` · ${friendList.length}` : ''}`,
        data: friendList.map((e) => ({ kind: 'friend-found' as const, entry: e })),
      },
    ],
    [hidden, foundList, friendList, t],
  );

  const openCacheByCoord = (coord: string) => {
    if (!coord) return;
    if (!parseCacheCoord(coord)) return;
    navigation.navigate('HuntPiggyDetail', { coord });
  };

  // Drafts have no relay event, so the public detail screen has nothing
  // to fetch. Open the Hide-a-Piglet wizard in edit mode instead — it
  // hydrates from the local HiddenPiggy via `loadPiggies` (#909). The
  // cache `d` equals the local record id.
  const openDraftForEdit = (d: string) => {
    if (!d) return;
    navigation.navigate('HuntCreate', { piggyId: d });
  };

  // Republish an expired Piglet — refresh the NIP-40 expiration tag
  // and re-emit the kind 37516 listing under the same `d` (NIP-33
  // addressable replacement). The LNURL bearer is reconstructed from
  // the local `HiddenPiggy` record only — never sourced from the
  // relay-side ParsedCache, which never carried it in the first place.
  const handleRepublish = useCallback(
    (cache: ParsedCache) => {
      const piggy = piggiesById.get(cache.d);
      if (!piggy) {
        Toast.show({
          type: 'error',
          text1: t('myPigletsScreen.cantRepublish'),
          text2: t('myPigletsScreen.cantRepublishBody'),
        });
        return;
      }
      Alert.alert(t('myPigletsScreen.republishTitle'), t('myPigletsScreen.republishBody'), [
        { text: t('myPigletsScreen.cancel'), style: 'cancel' },
        {
          text: t('myPigletsScreen.republish'),
          onPress: async () => {
            if (republishingCoord) return;
            setRepublishingCoord(cache.coord);
            try {
              const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
              const { newExpiresAt } = await republishPiggy(piggy, signEvent, writeRelays);
              // Optimistic local patch so the badge clears before
              // the relay round-trip lands. The kind 37516 we just
              // emitted will overwrite this entry naturally next
              // time the subscription tick refreshes.
              setAllCaches((prev) =>
                prev.map((c) =>
                  c.coord === cache.coord
                    ? { ...c, expiresAt: newExpiresAt, createdAt: Math.floor(Date.now() / 1000) }
                    : c,
                ),
              );
              setPiggiesById((prev) => {
                const next = new Map(prev);
                next.set(piggy.id, { ...piggy, expiresAt: newExpiresAt });
                return next;
              });
              Toast.show({ type: 'success', text1: t('myPigletsScreen.piggyRepublished') });
            } catch (e) {
              Toast.show({
                type: 'error',
                text1: t('myPigletsScreen.republishFailed'),
                text2: (e as Error).message,
              });
            } finally {
              setRepublishingCoord(null);
            }
          },
        },
      ]);
    },
    [piggiesById, relays, republishingCoord, signEvent, t],
  );

  return (
    <View style={styles.container} testID="my-piglets-screen">
      <View style={styles.header}>
        <BrandPatternBackground variant="explore-compass" />
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            accessibilityLabel={t('myPigletsScreen.back')}
            testID="my-piglets-back-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('myPigletsScreen.headerTitle')}</Text>
          <View style={{ width: 24 }} />
        </View>
        <Text style={styles.headerTagline}>{t('myPigletsScreen.headerTagline')}</Text>
      </View>

      <SectionList
        sections={sections}
        // SectionList's default render-bail otherwise skips renderItem
        // when `sections` reference-equals — but a kind 37516 echo that
        // only mutates `cacheByCoord` can land *without* my-finds /
        // friends'-finds list arrays changing, leaving the cached row
        // showing "Cache no longer on relays" until the next prop
        // change. Wiring the lookup map into `extraData` forces the
        // re-render the renderItem comment promises (#574 follow-up).
        extraData={cacheByCoord}
        keyExtractor={(item) =>
          item.kind === 'hidden' ? `h:${item.cache.coord}` : `${item.kind}:${item.entry.id}`
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brandPink}
            colors={[colors.brandPink]}
          />
        }
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.hideCta}
            onPress={() => navigation.navigate('HuntCreate')}
            accessibilityLabel={t('myPigletsScreen.hideAPiglet')}
            testID="my-piglets-hide-cta"
          >
            <Plus size={20} color={colors.white} strokeWidth={2.5} />
            <Text style={styles.hideCtaText}>{t('myPigletsScreen.hideAPiglet')}</Text>
          </TouchableOpacity>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <Text style={styles.emptySection}>{emptyTextFor(section.id)}</Text>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'hidden') {
            return (
              <Row
                cache={item.cache}
                meta={t('myPigletsScreen.pigletMeta', {
                  difficulty: item.cache.difficulty ?? '?',
                  terrain: item.cache.terrain ?? '?',
                })}
                colors={colors}
                styles={styles}
                onPress={() =>
                  item.isDraft ? openDraftForEdit(item.cache.d) : openCacheByCoord(item.cache.coord)
                }
                testID={`my-piglets-hidden-${item.cache.d}`}
                isDraft={item.isDraft}
                // Drafts aren't on relays yet, so there's nothing to
                // republish — only published rows get the republish wiring.
                onRepublish={item.isDraft ? undefined : () => handleRepublish(item.cache)}
                republishing={republishingCoord === item.cache.coord}
              />
            );
          }
          const entry = item.entry;
          // Cache resolution moved from the find-log subscribe callback
          // to this render path — see the FoundEntry comment. The lookup
          // is O(1) and we wire `cacheByCoord` into the SectionList via
          // `extraData` above so a late-arriving kind 37516 always
          // re-runs `renderItem` and the row's name re-paints, even on
          // the my-finds path (whose `foundList` useMemo doesn't itself
          // depend on the cache mirror).
          const matchingCache = cacheByCoord.get(entry.coord) ?? null;
          const meta =
            (entry.amountSats
              ? t('myPigletsScreen.foundSats', { count: entry.amountSats })
              : t('myPigletsScreen.found')) +
            (matchingCache?.name ? ` · ${matchingCache.name}` : '');
          return (
            <Row
              cache={matchingCache}
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

const emptyTextFor = (id: string): string => {
  if (id === 'hidden') return t('myPigletsScreen.emptyHidden');
  if (id === 'found') return t('myPigletsScreen.emptyFound');
  return t('myPigletsScreen.emptyFriendsFinds');
};

interface RowProps {
  cache: ParsedCache | null;
  meta: string;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
  testID: string;
  // Hidden-cache rows only — wires the ExpiryBadge's "Expired" state
  // to a tap-to-republish handler. Friend / find rows omit it.
  onRepublish?: () => void;
  republishing?: boolean;
  // True for a local-only draft (saved with Public off, not on relays).
  // Shows a "Draft" pill in place of the expiry badge (#909).
  isDraft?: boolean;
}

const Row: React.FC<RowProps> = ({
  cache,
  meta,
  colors,
  styles,
  onPress,
  testID,
  onRepublish,
  republishing,
  isDraft,
}) => {
  const t = useTranslation();
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={cache?.name ?? meta}
    >
      <View style={styles.iconContainer}>
        {cache?.imageUrl ? (
          <Image source={{ uri: cache.imageUrl }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View
            style={[
              styles.iconWrap,
              cache?.isLpPiggy === false ? styles.iconStandard : styles.iconLp,
            ]}
          >
            {cache?.isLpPiggy === false ? (
              <MapPin size={22} color={colors.white} strokeWidth={2} />
            ) : (
              <PiggyBank size={22} color={colors.white} strokeWidth={2} />
            )}
          </View>
        )}
        <LpPayoutBadge isLpPiggy={cache?.isLpPiggy ?? false} payoutSats={cache?.payoutSats} />
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowTitleRow}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {cache?.name ?? t('myPigletsScreen.cacheGone')}
          </Text>
          {/* Expiry badge — NIP-40-aware. Red pill for past-expiry caches
            so the hider knows their listing won't appear in finder
            searches anymore; subtle "N d" caption while still active.
            When `onRepublish` is supplied the Expired state becomes
            tappable and re-emits the listing with a fresh window. */}
          {isDraft ? (
            <View
              style={styles.draftBadge}
              testID={`${testID}-private-badge`}
              accessibilityLabel={t('myPigletsScreen.privateBadgeA11y')}
            >
              <Text style={styles.draftBadgeText}>{t('myPigletsScreen.private')}</Text>
            </View>
          ) : cache?.expiresAt != null ? (
            <ExpiryBadge
              expiresAt={cache.expiresAt}
              styles={styles}
              colors={colors}
              onRepublish={onRepublish}
              republishing={!!republishing}
            />
          ) : null}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.textSupplementary} />
    </TouchableOpacity>
  );
};

// Small pill rendered next to the cache name. Three states:
//   • already expired → red "Expired" — tappable on hidden-cache rows
//     to republish the listing with a fresh NIP-40 expiration tag
//   • < 14 days left  → amber "Ends Nd" (warn the hider it'll vanish soon)
//   • > 14 days left  → no badge (clean row)
// Used on hidden-cache rows to flag listings that have aged out of
// NIP-40 relay retention. Republishing (via this badge or the edit
// flow #22) resets the expiry.
const ExpiryBadge: React.FC<{
  expiresAt: number;
  styles: ReturnType<typeof createStyles>;
  colors: Palette;
  onRepublish?: () => void;
  republishing?: boolean;
}> = ({ expiresAt, styles, colors, onRepublish, republishing }) => {
  const t = useTranslation();
  const nowSec = Math.floor(Date.now() / 1000);
  const daysLeft = Math.round((expiresAt - nowSec) / 86400);
  if (daysLeft >= 14) return null;
  const isExpired = daysLeft < 0;
  const canRepublish = isExpired && !!onRepublish;
  const label = republishing
    ? t('myPigletsScreen.republishing')
    : isExpired
      ? canRepublish
        ? t('myPigletsScreen.republish')
        : t('myPigletsScreen.expired')
      : t('myPigletsScreen.endsInDays', { days: daysLeft });
  const badgeStyle = [
    styles.expiryBadge,
    isExpired ? styles.expiryBadgeExpired : styles.expiryBadgeWarn,
  ];
  const content = (
    <>
      {canRepublish && !republishing ? (
        <RotateCw size={11} color={colors.white} strokeWidth={2.5} />
      ) : null}
      {republishing ? <ActivityIndicator size="small" color={colors.white} /> : null}
      <Text style={styles.expiryBadgeText}>{label}</Text>
    </>
  );
  if (canRepublish) {
    return (
      <TouchableOpacity
        style={badgeStyle}
        onPress={onRepublish}
        disabled={republishing}
        accessibilityLabel={t('myPigletsScreen.republishExpiredA11y')}
        testID="my-piglets-republish"
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={badgeStyle}>{content}</View>;
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
    // Relative wrapper so the LpPayoutBadge anchors to the icon's corner.
    iconContainer: { position: 'relative' },
    rowMain: { flex: 1 },
    rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textHeader },
    rowMeta: { fontSize: 12, color: colors.textSupplementary, marginTop: 2 },
    expiryBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    expiryBadgeExpired: { backgroundColor: colors.red },
    expiryBadgeWarn: { backgroundColor: colors.zapYellow },
    // "Draft" pill for local-only Piglets that were saved with Public off
    // and haven't been published to relays yet (#909). Neutral grey so it
    // reads as informational, not a warning/error like the expiry pills.
    draftBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: colors.textSupplementary,
    },
    draftBadgeText: {
      color: colors.white,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    expiryBadgeText: {
      color: colors.white,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    center: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  });

export default MyPigletsScreen;
