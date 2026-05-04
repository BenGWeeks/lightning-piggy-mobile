import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import TabBackgroundImage from '../components/TabBackgroundImage';
import { FlashList } from '@shopify/flash-list';
import Svg, { Path } from 'react-native-svg';
import { Users, Clock, Search, X } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { useGroups } from '../contexts/GroupsContext';
import ConversationRow from '../components/ConversationRow';
import GroupRow from '../components/GroupRow';
import type { ContactInfo } from '../components/GroupAvatar';
import ContactProfileSheet from '../components/ContactProfileSheet';
import FriendPickerSheet, { type PickedFriend } from '../components/FriendPickerSheet';
import CreateGroupSheet from '../components/CreateGroupSheet';
import type { GroupSummary } from '../types/groups';
import { MessageCircle } from 'lucide-react-native';
import TabHeader from '../components/TabHeader';
import { useThemeColors } from '../contexts/ThemeContext';
import {
  buildConversationSummaries,
  buildDmSummaries,
  conversationPreview,
  mergeSummaries,
  type ConversationSummary,
} from '../utils/conversationSummaries';
import { createMessagesScreenStyles } from '../styles/MessagesScreen.styles';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';

type MessagesNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Messages'>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface AnonContact {
  id: string;
  name: string;
  picture: string | null;
  banner: string | null;
  nip05: string | null;
  lightningAddress: string | null;
  pubkey: string | null;
  source: 'nostr' | 'contacts';
}

const MessagesScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMessagesScreenStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<MessagesNavigation>();
  const {
    isLoggedIn,
    profile,
    contacts,
    refreshContacts,
    refreshProfile,
    dmInbox,
    refreshDmInbox,
  } = useNostr();
  const { wallets } = useWallet();
  // followingOnly + setFollowingOnly + devMode are owned by GroupsContext
  // and shared with the Messages tab so toggling on either screen flips
  // the same global "Following only" notion. Mirrors the chip wiring in
  // GroupsScreen — interactive only when devMode is on.
  const { groupSummaries, followingOnly, setFollowingOnly, devMode } = useGroups();
  // Track the last-applied followingOnly state so that flipping the
  // dev-mode chip triggers a force-refresh that asks refreshDmInbox to
  // bypass the data-layer follow gate. Without this, toggling off would
  // only widen the screen+summary filter on already-cached entries —
  // unfollowed senders' wraps that the previous follows-on refresh
  // dropped at the decrypt loop would stay invisible.
  const lastAppliedFollowingOnlyRef = useRef<boolean>(true);
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  const [anonSheetContact, setAnonSheetContact] = useState<AnonContact | null>(null);
  const [windowDays, setWindowDays] = useState<30 | 90>(30);

  useEffect(() => {
    AsyncStorage.getItem('messages_window_days').then((v) => {
      if (v === '90') setWindowDays(90);
    });
  }, []);

  const cycleWindowDays = useCallback(() => {
    setWindowDays((prev) => {
      const next: 30 | 90 = prev === 30 ? 90 : 30;
      AsyncStorage.setItem('messages_window_days', String(next)).catch(() => {});
      return next;
    });
  }, []);

  // Defer the refresh until the Messages tab's transition animation
  // and first-paint have finished. The refresh itself (relay fetches
  // + decrypt loop) holds the JS thread for 3-5 s; running it inside
  // the focus-effect callback synchronously meant navigating away
  // from Messages felt laggy because the NEXT tab's render queued
  // behind it. InteractionManager yields to the scheduler and runs
  // the work once the UI is idle. `.cancel()` in cleanup avoids
  // firing the refresh on a focus that was already abandoned.
  //
  // Also pre-warms the friend-picker avatar bitmaps. Histograms from
  // perf-suite showed the FAB → FriendPicker open path spends most
  // of its modern-jank budget on cold avatar decode. Prefetching the
  // avatars the picker will actually display (filtered + sorted to
  // match FriendPickerSheet's friends memo, capped at 50) pushes the
  // decode cost OUT of the FAB-tap-to-content window. By the time the
  // user taps (+), `expo-image`'s disk cache is warm and the avatars
  // render without a fresh decode. See plan in #245.
  //
  // TTL gate (30 s) so the prefetch doesn't re-fire on every
  // contacts-array change — `loadContacts` updates contacts
  // incrementally as kind-0 profile batches arrive, which would
  // otherwise schedule the same 50-avatar prefetch on every drip.
  // Mirrors the same pattern used by `dmInboxLastRefreshAt`.
  const lastAvatarPrefetchAt = useRef<number>(0);
  // TTL gate for the focus-driven inbox refresh. Without it, every focus
  // (including the back-from-group transition) triggered a full
  // refreshDmInbox cached-loop on the JS thread for ~3 s on a chunky
  // inbox — perceived as MessagesScreen freezing right after the back
  // animation lands (#286 / #300). 30 s mirrors the avatar-prefetch TTL
  // below; the live `subscribeGroupMessages` channel covers delivery
  // for any wraps that arrive while the user was inside a group.
  const dmInboxLastRefreshAt = useRef<number>(0);
  const DM_INBOX_REFRESH_TTL_MS = 30_000;
  // Force-refresh the inbox whenever the followingOnly toggle flips so
  // includeNonFollows is re-applied at the data layer. devMode is also
  // a dep — leaving it stale could let a non-dev session pass
  // includeNonFollows=true on the first refresh after a logout/login.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (lastAppliedFollowingOnlyRef.current === followingOnly) return;
    lastAppliedFollowingOnlyRef.current = followingOnly;
    refreshDmInbox({ force: true, includeNonFollows: devMode && !followingOnly });
  }, [followingOnly, devMode, isLoggedIn, refreshDmInbox]);
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      const handle = InteractionManager.runAfterInteractions(() => {
        if (Date.now() - dmInboxLastRefreshAt.current >= DM_INBOX_REFRESH_TTL_MS) {
          dmInboxLastRefreshAt.current = Date.now();
          refreshDmInbox();
        }

        const PREFETCH_TTL_MS = 30_000;
        if (Date.now() - lastAvatarPrefetchAt.current < PREFETCH_TTL_MS) return;

        // Match FriendPickerSheet's `friends` memo: drop entries with
        // no resolved name (the picker hides them), sort by first
        // Latin letter then by lower-case name, then take the first
        // 50. That's the set the user will see in the initial sheet
        // viewport — prefetching them is the relevant warm-up.
        //
        // firstAlpha mirrors FriendPickerSheet's local helper: NFKD-
        // normalise + uppercase, return first [A-Z] char or '#'.
        const firstAlpha = (n: string): string => {
          const m = n.normalize('NFKD').toUpperCase().match(/[A-Z]/);
          return m ? m[0] : '#';
        };
        const named: { picture: string; fa: string; lc: string }[] = [];
        for (const c of contacts) {
          const name = (c.profile?.displayName || c.profile?.name || c.petname || '').trim();
          const picture = c.profile?.picture;
          if (!name || !picture) continue;
          named.push({ picture, fa: firstAlpha(name), lc: name.toLowerCase() });
        }
        named.sort((a, b) => {
          if (a.fa !== b.fa) return a.fa.localeCompare(b.fa);
          return a.lc.localeCompare(b.lc);
        });
        const avatarUrls = named.slice(0, 50).map((x) => x.picture);

        if (avatarUrls.length === 0) return;

        lastAvatarPrefetchAt.current = Date.now();
        ExpoImage.prefetch(avatarUrls, 'memory-disk').catch(() => {
          // Prefetch failures are silent — falls back to on-demand
          // decode at sheet open time, the un-fixed behaviour. No
          // user-visible regression.
        });
      });
      return () => handle.cancel();
    }, [isLoggedIn, refreshDmInbox, contacts]),
  );

  const followPubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) set.add(c.pubkey.toLowerCase());
    return set;
  }, [contacts]);

  // Single pubkey → ContactInfo lookup for the screen, shared by every
  // row + handler. Three previously-separate `contacts.find()` paths
  // (GroupAvatar's avatar cluster, GroupRow's sender-name preview, and
  // handleConversationPress's picture/lightning-address fallback) now
  // all consult this map, so a 50-contact x N-row screen does O(contacts)
  // once per render instead of O(rows × contacts) per render. See #245.
  const contactInfoMap = useMemo(() => {
    const map = new Map<string, ContactInfo>();
    for (const c of contacts) {
      map.set(c.pubkey.toLowerCase(), {
        picture: c.profile?.picture ?? null,
        name: (c.profile?.displayName || c.profile?.name || c.petname || '').trim() || null,
        lightningAddress: c.profile?.lud16 ?? null,
      });
    }
    return map;
  }, [contacts]);

  const conversationSummaries = useMemo(() => {
    const zap = buildConversationSummaries(wallets, contacts);
    // Pass followPubkeys as a defence-in-depth filter. NostrContext's
    // refreshDmInbox already drops non-follows at the data layer, but
    // applying it again here guards against stale dmInbox state from
    // before a follow was revoked. The "Following only" rule is
    // load-bearing — keep it enforced everywhere a summary is built.
    // followingOnly off (only possible when devMode is on; the chip is
    // non-interactive in production) → pass undefined so buildDmSummaries
    // skips its follow gate entirely. Filter still runs at the data layer
    // unless refreshDmInbox is invoked with includeNonFollows: true.
    const dm = buildDmSummaries(dmInbox, contacts, followingOnly ? followPubkeys : undefined);
    return mergeSummaries(zap, dm);
  }, [wallets, contacts, dmInbox, followPubkeys, followingOnly]);

  // Following-only is always on by design (parental-control requirement);
  // enforcement lives inside buildDmSummaries + refreshDmInbox. This memo
  // applies the user-selectable time window + search, plus a defensive
  // follow check for pubkey'd zap rows so non-followed zap counterparties
  // don't slip in. Groups go through their own follow gate inside
  // GroupsContext.visibleGroups, so we just merge the result here.
  type InboxRow =
    | { kind: 'dm'; summary: ConversationSummary; sortKey: number }
    | { kind: 'group'; summary: GroupSummary; sortKey: number };

  const filteredRows = useMemo<InboxRow[]>(() => {
    const cutoff = Math.floor(Date.now() / 1000) - windowDays * 86400;
    const lower = search.trim().toLowerCase();

    const dmRows: InboxRow[] = conversationSummaries
      .filter((s) => {
        if (s.lastActivityAt < cutoff) return false;
        // Defence-in-depth follow gate — only enforced when followingOnly
        // is on. In production the chip is non-interactive so this is
        // always true (matches buildDmSummaries above and the data layer).
        if (followingOnly && s.pubkey && !followPubkeys.has(s.pubkey.toLowerCase())) return false;
        if (!lower) return true;
        return (
          s.name.toLowerCase().includes(lower) ||
          conversationPreview(s).toLowerCase().includes(lower)
        );
      })
      .map((s) => ({ kind: 'dm', summary: s, sortKey: s.lastActivityAt }));

    const groupRows: InboxRow[] = groupSummaries
      .filter((g) => {
        if (g.activity.lastActivityAt < cutoff) return false;
        if (!lower) return true;
        return (
          g.group.name.toLowerCase().includes(lower) ||
          g.activity.lastText.toLowerCase().includes(lower)
        );
      })
      .map((g) => ({ kind: 'group', summary: g, sortKey: g.activity.lastActivityAt }));

    return [...dmRows, ...groupRows].sort((a, b) => b.sortKey - a.sortKey);
  }, [conversationSummaries, groupSummaries, search, followPubkeys, followingOnly, windowDays]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // Pull-to-refresh is explicit user intent — force-bypass the 24h
    // own-profile cache so renames published elsewhere surface now,
    // and also bypass the 30s DM-inbox TTL so the relay query actually
    // runs (the TTL's default path is for useFocusEffect tab bounces).
    //
    // Important: `refreshContacts` must complete BEFORE
    // `refreshDmInbox`. The DM refresh filters by the logged-in user's
    // current follow set, and if we run them in parallel the DM query
    // captures the stale closure before the new contacts state lands,
    // so any new-since-last-refresh followers' messages get dropped
    // by the follow gate. Profile refresh is independent and can run
    // in parallel.
    //
    // try/finally so a relay timeout / decrypt throw doesn't leave the
    // UI stuck in the "refreshing" spinner state.
    try {
      await Promise.all([refreshContacts(), refreshProfile({ force: true })]);
      await refreshDmInbox({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, [refreshContacts, refreshDmInbox, refreshProfile]);

  const handleConversationPress = useCallback(
    (summary: ConversationSummary) => {
      const info = summary.pubkey ? contactInfoMap.get(summary.pubkey.toLowerCase()) : undefined;
      const picture = summary.picture ?? info?.picture ?? null;
      const lightningAddress = summary.lightningAddress ?? info?.lightningAddress ?? null;
      if (summary.pubkey) {
        navigation.navigate('Conversation', {
          pubkey: summary.pubkey,
          name: summary.name,
          picture,
          lightningAddress,
        });
        return;
      }
      // Anonymous zap: no pubkey to thread against. Surface what we have via
      // the profile sheet so the user can at least see the zap metadata.
      setAnonSheetContact({
        id: `conv-${summary.id}`,
        name: summary.name,
        picture,
        banner: null,
        nip05: summary.nip05,
        lightningAddress,
        pubkey: null,
        source: 'nostr',
      });
    },
    [contactInfoMap, navigation],
  );

  const handleStartConversation = useCallback(() => {
    setPickerVisible(true);
  }, []);

  const handlePickerSelect = useCallback(
    (friend: PickedFriend) => {
      setPickerVisible(false);
      navigation.navigate('Conversation', {
        pubkey: friend.pubkey,
        name: friend.name,
        picture: friend.picture,
        lightningAddress: friend.lightningAddress,
      });
    },
    [navigation],
  );

  const handleGroupPress = useCallback(
    (g: GroupSummary) => {
      navigation.navigate('GroupConversation', { groupId: g.group.id });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: InboxRow }) => {
      // Pass the parent handler reference directly (stable across renders)
      // and let ConversationRow / GroupRow bind the row's summary into the
      // press callback at the leaf. Previously we passed an inline arrow
      // (`() => handleX(item.summary)`) which was a fresh reference per
      // render and defeated the row's React.memo. (#300 follow-up.)
      if (item.kind === 'dm') {
        return <ConversationRow summary={item.summary} onPress={handleConversationPress} />;
      }
      return (
        <GroupRow
          summary={item.summary}
          onPress={handleGroupPress}
          contactInfoMap={contactInfoMap}
        />
      );
    },
    [handleConversationPress, handleGroupPress, contactInfoMap],
  );

  return (
    <View style={styles.container}>
      <TabBackgroundImage style={styles.bgImage} />
      <TabHeader title="Messages" icon={<MessageCircle size={20} color={colors.brandPink} />} />
      <View style={styles.headerExtras}>
        <View style={styles.chipRow}>
          {searchExpanded ? (
            <View style={styles.searchRow}>
              <Search size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search conversations..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search conversations"
                testID="messages-search-input"
              />
              <TouchableOpacity
                onPress={() => {
                  setSearch('');
                  setSearchExpanded(false);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close search"
                testID="messages-close-search"
              >
                <X size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={styles.searchToggle}
                onPress={() => {
                  setSearchExpanded(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                accessibilityLabel="Search conversations"
                testID="messages-search-toggle"
              >
                <Search size={18} color="rgba(255,255,255,0.8)" strokeWidth={2} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.content}>
        {isLoggedIn && (
          <View style={styles.filterChipRow}>
            {devMode ? (
              <TouchableOpacity
                style={followingOnly ? styles.filterChip : styles.filterChipOff}
                onPress={() => setFollowingOnly(!followingOnly)}
                accessibilityLabel={
                  followingOnly
                    ? 'Following-only filter on. Tap to show all conversations (dev mode).'
                    : 'Following-only filter off. Tap to filter to followed senders only.'
                }
                accessibilityRole="button"
                testID="messages-follows-toggle"
              >
                <Users
                  size={14}
                  color={followingOnly ? colors.brandPink : colors.textSupplementary}
                />
                <Text style={followingOnly ? styles.filterChipText : styles.filterChipTextOff}>
                  {followingOnly ? 'Following only' : 'All (dev)'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View
                style={styles.filterChip}
                accessibilityLabel="Showing conversations from people you follow only"
                testID="messages-follows-indicator"
              >
                <Users size={14} color={colors.brandPink} />
                <Text style={styles.filterChipText}>Following only</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.filterChipInteractive}
              onPress={cycleWindowDays}
              accessibilityLabel={`Window: last ${windowDays} days. Tap to change.`}
              accessibilityRole="button"
              testID="messages-window-toggle"
            >
              <Clock size={14} color={colors.brandPink} />
              <Text style={styles.filterChipText}>Last {windowDays} days</Text>
            </TouchableOpacity>
          </View>
        )}
        {!isLoggedIn ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Connect Nostr</Text>
            <Text style={styles.emptySubtitle}>
              Connect your Nostr identity to see your conversations here.
            </Text>
            <TouchableOpacity
              style={styles.connectButton}
              onPress={() => navigation.getParent()?.dispatch({ type: 'OPEN_DRAWER' })}
            >
              <Text style={styles.connectButtonText}>Go to Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlashList
            data={filteredRows}
            keyExtractor={(item) =>
              item.kind === 'dm' ? `dm:${item.summary.id}` : `group:${item.summary.group.id}`
            }
            renderItem={renderItem}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>
                  {search ? 'No matches' : 'No conversations yet'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {search ? 'Try a different search term.' : 'Zap a friend or tap + to start one.'}
                </Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        )}

        {isLoggedIn && (
          <TouchableOpacity
            style={styles.fab}
            onPress={handleStartConversation}
            accessibilityLabel="Start new conversation"
            testID="start-conversation-button"
            activeOpacity={0.85}
          >
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M12 5v14M5 12h14" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        )}
      </View>

      <FriendPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handlePickerSelect}
        title="Start a conversation"
        onNewGroup={() => {
          setPickerVisible(false);
          setCreateGroupVisible(true);
        }}
      />

      <CreateGroupSheet
        visible={createGroupVisible}
        onClose={() => setCreateGroupVisible(false)}
        onCreated={(group) => {
          setCreateGroupVisible(false);
          navigation.navigate('GroupConversation', { groupId: group.id });
        }}
      />

      <ContactProfileSheet
        visible={anonSheetContact !== null}
        onClose={() => setAnonSheetContact(null)}
        contact={anonSheetContact}
      />
    </View>
  );
};

export default MessagesScreen;
