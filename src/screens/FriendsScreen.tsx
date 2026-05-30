import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useDeferredValue,
  Profiler,
} from 'react';
import { View, Text, TextInput, TouchableOpacity, RefreshControl } from 'react-native';
import { InteractionManager } from 'react-native';
import TabBackgroundImage from '../components/TabBackgroundImage';
import { Alert } from '../components/BrandedAlert';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import Svg, { Circle, Path } from 'react-native-svg';
import { Users, Search, X } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, CompositeNavigationProp, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { fetchProfile } from '../services/nostrService';
import { useWallet } from '../contexts/WalletContext';
import TabHeader from '../components/TabHeader';
import { useThemeColors } from '../contexts/ThemeContext';
import ContactListItem, { CONTACT_LIST_ITEM_HEIGHT } from '../components/ContactListItem';
import ContactProfileSheet from '../components/ContactProfileSheet';
import AddFriendSheet from '../components/AddFriendSheet';
import AddContactCelebration from '../components/AddContactCelebration';
import { nip19 } from 'nostr-tools';
import SendSheet from '../components/SendSheet';
import AlphabetBar from '../components/AlphabetBar';
import { fetchPhoneContacts, PhoneContact } from '../services/contactsService';
import { createFriendsScreenStyles } from '../styles/FriendsScreen.styles';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';

type FriendsNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Friends'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Filter = 'all' | 'nostr' | 'contacts';
const FILTER_STORAGE_KEY = 'friends_filter';
const FILTER_VALUES: readonly Filter[] = ['all', 'nostr', 'contacts'] as const;
const isFilter = (v: string | null): v is Filter =>
  v !== null && (FILTER_VALUES as readonly string[]).includes(v);

// Cached at module scope so every keystroke doesn't construct a fresh
// Intl.Collator (5-10× slower than reusing one). 'base' sensitivity is
// case- and accent-insensitive — appropriate for friend-list ordering.
// See issue #245.
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

// First alphabet bucket for a name: NFKD-normalise + uppercase, then take the
// first A-Z char, else '#'. Mirrors MessagesScreen — without the NFKD step an
// accented INITIAL (É, Ö, …) fails the /[A-Z]/ test and wrongly lands in '#'
// instead of E / O (#660 review).
const firstAlpha = (name: string): string => {
  const m = name.normalize('NFKD').toUpperCase().match(/[A-Z]/);
  return m ? m[0] : '#';
};

interface ListItem {
  id: string;
  name: string;
  picture: string | null;
  banner: string | null;
  nip05: string | null;
  lightningAddress: string | null;
  // Whether the contact has a Lightning address at all (presence). Derived
  // from the slimmed profile's `hasLud16` flag since the actual `lud16` value
  // is stripped on the batch path; drives whether the list shows a zap button.
  hasLightningAddress: boolean;
  pubkey: string | null;
  source: 'nostr' | 'contacts';
}

const FriendsScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createFriendsScreenStyles(colors), [colors]);
  const navigation = useNavigation<FriendsNavigation>();
  const { isLoggedIn, profile, refreshProfile, relays } = useNostr();
  const { contacts, refreshContacts, addContact } = useNostrContacts();
  // Wallet-attached flag drives the per-row zap gate alongside the
  // contact's Lightning address. Without a wallet there's nothing to
  // pay from, so the zap action is rendered disabled even when the
  // contact has a perfectly valid lud16.
  const { hasWallets } = useWallet();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  // Drives the expensive filter step off a deferred copy of `search`,
  // so a fast typist doesn't drop keystrokes while the list re-filters.
  // Same pattern FriendPickerSheet uses for its sheet-side search
  // (see #243). Issue #245.
  const deferredSearch = useDeferredValue(search);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<PhoneContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<ListItem | null>(null);
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  const [addFriendVisible, setAddFriendVisible] = useState(false);
  // Add-contact celebration (#660): set on a successful add (or an
  // already-following tap) to pop the confetti + "Open profile" card.
  const [celebration, setCelebration] = useState<{
    pubkey: string;
    name: string;
    picture: string | null;
    alreadyConnected: boolean;
  } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [zapTarget, setZapTarget] = useState<ListItem | null>(null);
  const [currentLetter, setCurrentLetter] = useState<string | null>(null);
  const scrollTrackingPaused = useRef(false);
  // Performance instrumentation (dev only)
  const screenMountTime = useRef(Date.now());
  const firstRenderLogged = useRef(false);
  const onProfilerRender = useCallback(
    (
      _id: string,
      phase: 'mount' | 'update' | 'nested-update',
      actualDuration: number,
      baseDuration: number,
    ) => {
      if (!__DEV__) return;
      if (!firstRenderLogged.current && contacts.length > 0) {
        firstRenderLogged.current = true;
        console.log(
          `[Perf] FriendsList first render: ${Date.now() - screenMountTime.current}ms from mount, ` +
            `actual=${actualDuration.toFixed(1)}ms, base=${baseDuration.toFixed(1)}ms`,
        );
      }
      if (actualDuration > 16) {
        console.log(
          `[Perf] FriendsList ${phase}: actual=${actualDuration.toFixed(1)}ms, base=${baseDuration.toFixed(1)}ms`,
        );
      }
    },
    [contacts.length],
  );

  // Phone contacts are fetched via useFocusEffect below — it fires on
  // every focus including the first mount, so the mount-time useEffect
  // that previously ran the same fetch was a duplicate. Dropped to
  // avoid two back-to-back fetches on initial mount (#439 review).

  // Restore the persisted Friends-tab filter selection on mount so it
  // survives app restarts (#311). Mirrors the AsyncStorage pattern
  // used for `messages_window_days` in MessagesScreen — get on mount,
  // setItem on every change. Falls back to 'all' if the stored value
  // is missing or not a recognised Filter — same default as a
  // brand-new install.
  useEffect(() => {
    AsyncStorage.getItem(FILTER_STORAGE_KEY)
      .then((v) => {
        if (isFilter(v)) setFilter(v);
      })
      .catch(() => {});
  }, []);

  const setFilterAndPersist = useCallback((next: Filter) => {
    setFilter(next);
    AsyncStorage.setItem(FILTER_STORAGE_KEY, next).catch(() => {});
  }, []);

  // Force-refresh the own-profile kind-0 on focus so the top-right
  // profile icon picks up external renames (e.g. via Amber or another
  // client) without waiting for the 24h cache to expire. See #148.
  //
  // Deferred via InteractionManager so the tab-transition animation
  // and first-paint of the Friends list finish *before* the (3-5 s)
  // refresh kicks off — otherwise the JS thread's busy on the refresh
  // while React is trying to render, and navigating away then feels
  // laggy until the refresh completes.
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      const handle = InteractionManager.runAfterInteractions(() => refreshProfile());
      return () => handle.cancel();
    }, [isLoggedIn, refreshProfile]),
  );

  // Re-fetch phone contacts on focus so a Lightning-address edit
  // applied in ContactProfileScreen is reflected here when the user
  // returns. Cheap (AsyncStorage read + a bit of Contacts API merge).
  useFocusEffect(
    useCallback(() => {
      fetchPhoneContacts()
        .then(setPhoneContacts)
        .catch(() => {});
    }, []),
  );

  // Step 1: build + sort the full list. This memo invalidates only when
  // the underlying contact sources or the chip filter change — NOT on
  // every keystroke. The N-log-N Intl.Collator sort runs once per source
  // change rather than once per keystroke. See issue #245.
  const sortedItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    if (filter !== 'contacts') {
      for (const c of contacts) {
        items.push({
          id: `nostr-${c.pubkey}`,
          name: (
            c.profile?.displayName ||
            c.profile?.name ||
            c.petname ||
            c.pubkey.slice(0, 12)
          ).trim(),
          picture: c.profile?.picture ?? null,
          banner: c.profile?.banner ?? null,
          nip05: c.profile?.nip05 ?? null,
          lightningAddress: c.profile?.lud16 ?? null,
          // lud16 value is stripped on the batch path; hasLud16 records its
          // presence so the list can show the zap affordance for zappable
          // contacts (the verified address is re-resolved at zap time).
          hasLightningAddress: !!(c.profile?.lud16 || c.profile?.hasLud16),
          pubkey: c.pubkey,
          source: 'nostr',
        });
      }
    }

    if (filter !== 'nostr') {
      for (const c of phoneContacts) {
        items.push({
          id: `phone-${c.id}`,
          name: c.name,
          picture: null,
          banner: null,
          nip05: null,
          lightningAddress: c.lightningAddress,
          hasLightningAddress: !!c.lightningAddress,
          pubkey: null,
          source: 'contacts',
        });
      }
    }

    items.sort((a, b) => NAME_COLLATOR.compare(a.name, b.name));
    return items;
  }, [contacts, phoneContacts, filter]);

  // Step 2: filter the pre-sorted list by `deferredSearch`. Substring
  // match is O(n) per keystroke but with no allocations and no sort —
  // and `useDeferredValue` lets React stale-render this filter step
  // when the JS thread is busy, so input characters don't drop.
  const combinedList = useMemo<ListItem[]>(() => {
    const lower = deferredSearch.trim().toLowerCase();
    if (!lower) return sortedItems;
    return sortedItems.filter(
      (item) =>
        item.name.toLowerCase().includes(lower) ||
        (item.lightningAddress && item.lightningAddress.toLowerCase().includes(lower)),
    );
  }, [sortedItems, deferredSearch]);

  const flatListRef = useRef<FlashListRef<ListItem>>(null);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const item of combinedList) {
      letters.add(firstAlpha(item.name));
    }
    return Array.from(letters).sort();
  }, [combinedList]);

  // Row height comes from ContactListItem (44 avatar + 14×2 padding).
  // Imported rather than duplicated so a future avatar-size change only
  // needs updating in one place. Used below to compute deterministic
  // alphabet-tap offsets — scrollToIndex could silently no-op on
  // warm-cache devices when the target row hadn't been virtualised yet
  // (see #178). FlashList v2 auto-measures, so there's no size-hint API
  // to give it (overrideItemLayout in v2 only controls column span).
  //
  // LIST_PADDING_TOP must match styles.listContent.paddingTop — the
  // FlashList's contentContainerStyle shifts row 0 down by that amount,
  // so any offset math needs to add it back to land on the right row.
  // If you change styles.listContent.paddingTop, update this too.
  const ITEM_HEIGHT = CONTACT_LIST_ITEM_HEIGHT;
  const LIST_PADDING_TOP = 12;

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      if (scrollTrackingPaused.current) return;
      const offsetY = e.nativeEvent.contentOffset.y;
      const index = Math.floor(Math.max(0, offsetY - LIST_PADDING_TOP) / ITEM_HEIGHT);
      if (index >= 0 && index < combinedList.length) {
        const letter = firstAlpha(combinedList[index].name);
        if (letter !== currentLetter) {
          setCurrentLetter(letter);
        }
      }
    },
    [combinedList, currentLetter],
  );

  const scrollToLetter = useCallback(
    (letter: string) => {
      const t0 = __DEV__ ? performance.now() : 0;
      const index = combinedList.findIndex((item) => firstAlpha(item.name) === letter);
      if (index >= 0) {
        // Pause scroll tracking to prevent currentLetter flashing during scroll
        scrollTrackingPaused.current = true;
        setCurrentLetter(letter);
        // Use scrollToOffset with the pinned row height instead of
        // scrollToIndex. On a warm cache, offscreen rows haven't been
        // measured yet and scrollToIndex can no-op leaving the viewport
        // blank (see #178). Offset math is O(1) given the uniform height.
        flatListRef.current?.scrollToOffset({
          offset: LIST_PADDING_TOP + index * ITEM_HEIGHT,
          animated: false,
        });
        setTimeout(() => {
          scrollTrackingPaused.current = false;
        }, 500);
        if (__DEV__) {
          console.log(
            `[Perf] scrollToLetter(${letter}): ${(performance.now() - t0).toFixed(1)}ms, index=${index}`,
          );
        }
      }
    },
    [combinedList],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshContacts();
    const updated = await fetchPhoneContacts();
    setPhoneContacts(updated);
    setRefreshing(false);
  }, [refreshContacts]);

  const handleZap = useCallback(
    async (item: ListItem) => {
      if (!hasWallets) {
        Alert.alert('No wallet attached', 'Connect a Lightning wallet first to send zaps.');
        return;
      }
      // The contacts-list profile has its lud16 stripped (anti-redirect
      // slimming), so resolve the *verified* address on demand before paying.
      let address = item.lightningAddress;
      if (!address && item.pubkey) {
        const readRelays = relays.filter((r) => r.read).map((r) => r.url);
        const verified = await fetchProfile(item.pubkey, readRelays);
        address = verified?.lud16 ?? null;
      }
      if (!address) {
        Alert.alert(
          'No Lightning address',
          `${item.name} hasn’t published a Lightning address, so they can’t receive zaps yet.`,
        );
        return;
      }
      setZapTarget({ ...item, lightningAddress: address });
      setSendOpen(true);
    },
    [hasWallets, relays],
  );

  // Tap on a friend row → open the bottom-sheet preview. The sheet
  // gives a quick peek (QR, npub, copy, Zap / Message / Share) without
  // leaving the list; its "View full profile" link drills into the
  // full ContactProfile route when the user wants the deep view.
  const handleContactPress = useCallback((item: ListItem) => {
    setSelectedContact(item);
    setProfileSheetVisible(true);
  }, []);

  const handleViewFullProfile = useCallback(() => {
    if (!selectedContact) return;
    const item = selectedContact;
    const phoneContactId = item.source === 'contacts' ? item.id.replace('phone-', '') : undefined;
    setProfileSheetVisible(false);
    navigation.navigate('ContactProfile', {
      contact: {
        pubkey: item.pubkey,
        name: item.name,
        picture: item.picture,
        banner: item.banner,
        nip05: item.nip05,
        lightningAddress: item.lightningAddress,
        source: item.source,
      },
      phoneContactId,
    });
  }, [selectedContact, navigation]);

  const handleAddFriend = useCallback(
    async (npubOrHex: string) => {
      const result = await addContact(npubOrHex);
      if (result.success) {
        const pk = result.pubkey;
        // A brand-new follow isn't in `contacts` state yet (the append is
        // async), so the npub prefix is the expected fallback there; an
        // already-following tap resolves to the real name. Trim each
        // candidate so a whitespace-only display name doesn't win and leave
        // the card reading "connected to ." (#662 review).
        const existing = contacts.find((c) => c.pubkey === pk);
        const name =
          existing?.profile?.displayName?.trim() ||
          existing?.profile?.name?.trim() ||
          existing?.petname?.trim() ||
          `${nip19.npubEncode(pk).slice(0, 12)}…`;
        setCelebration({
          pubkey: pk,
          name,
          picture: existing?.profile?.picture ?? null,
          alreadyConnected: !!result.alreadyFollowing,
        });
        return true;
      }
      Alert.alert('Error', result.error || 'Failed to add contact');
      return false;
    },
    [addContact, contacts],
  );

  // Resolve the celebration's name + avatar LIVE from `contacts` rather than the
  // snapshot taken at add-time: a brand-new follow isn't in `contacts` yet when
  // the card opens, but followContact fetches its kind-0 and updates `contacts`
  // shortly after — recomputing here makes the avatar + real name appear in the
  // open card the moment they resolve (#662). Falls back to the snapshot.
  const celebDisplay = useMemo(() => {
    if (!celebration) return { name: '', picture: null as string | null };
    const c = contacts.find((x) => x.pubkey === celebration.pubkey);
    const name =
      c?.profile?.displayName?.trim() ||
      c?.profile?.name?.trim() ||
      c?.petname?.trim() ||
      celebration.name;
    return { name, picture: c?.profile?.picture ?? celebration.picture ?? null };
  }, [celebration, contacts]);

  const handleCelebrationOpenProfile = useCallback(() => {
    if (!celebration) return;
    const pk = celebration.pubkey;
    const existing = contacts.find((c) => c.pubkey === pk);
    setCelebration(null);
    navigation.navigate('ContactProfile', {
      contact: {
        pubkey: pk,
        // Use the same live-resolved values the card shows (celebDisplay) so a
        // profile that resolved while the card was open doesn't hand the
        // profile screen the stale npub/null snapshot (#662 review).
        name: celebDisplay.name,
        picture: celebDisplay.picture,
        banner: existing?.profile?.banner ?? null,
        nip05: existing?.profile?.nip05 ?? null,
        lightningAddress: existing?.profile?.lud16 ?? null,
        source: 'nostr',
      },
    });
  }, [celebration, celebDisplay, contacts, navigation]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      // Zap affordance only shows for contacts that actually have a
      // Lightning address (hasLightningAddress). When shown it's enabled
      // as long as the user has a wallet — the verified address is
      // re-resolved on tap; greyed + tappable-for-why when there's no
      // wallet. Message needs a Nostr pubkey (phone-only contacts don't
      // have one). Disabled-reason strings are read to screen readers.
      const canZap = hasWallets;
      const zapDisabledReason = 'no wallet attached';
      return (
        <ContactListItem
          name={item.name}
          picture={item.picture}
          lightningAddress={item.lightningAddress}
          canMessage={!!item.pubkey}
          canZap={canZap}
          showZap={item.hasLightningAddress}
          zapDisabledReason={zapDisabledReason}
          onPress={() => handleContactPress(item)}
          onZap={() => handleZap(item)}
          onMessage={
            // Capture pubkey in a non-null const so TS narrows it inside
            // the closure — referencing item.pubkey directly inside the
            // arrow body widens it back to `string | null`.
            (() => {
              const pubkey = item.pubkey;
              if (!pubkey) return undefined;
              return () =>
                navigation.navigate('Conversation', {
                  pubkey,
                  name: item.name,
                  picture: item.picture,
                  lightningAddress: item.lightningAddress,
                });
            })()
          }
          testID={`friend-row-${item.id}`}
        />
      );
    },
    [handleZap, handleContactPress, hasWallets, navigation],
  );

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'nostr', label: 'Nostr' },
    { key: 'contacts', label: 'Contacts' },
  ];

  return (
    <View style={styles.container}>
      <TabBackgroundImage style={styles.bgImage} />
      <TabHeader title="Friends" icon={<Users size={20} color={colors.brandPink} />} />
      <View style={styles.headerExtras}>
        {/* Filter chips + search toggle */}
        <View style={styles.chipRow}>
          {searchExpanded ? (
            <View style={styles.searchRow}>
              <Search size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search friends"
                testID="search-input"
              />
              <TouchableOpacity
                onPress={() => {
                  setSearch('');
                  setSearchExpanded(false);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close search"
                testID="close-search"
              >
                <X size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {filters.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.chip, filter === f.key && styles.chipActive]}
                  onPress={() => setFilterAndPersist(f.key)}
                  accessibilityLabel={`${f.label} filter`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f.key }}
                  testID={`friends-filter-${f.key}`}
                >
                  <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
              {/* Hidden marker so Maestro can assert WHICH filter is active (e.g. after a cold restart) without relying on accessibilityState, which RN exposes inconsistently across Android versions. */}
              <View testID={`friends-filter-active-${filter}`} accessibilityElementsHidden />

              <TouchableOpacity
                style={styles.searchToggle}
                onPress={() => {
                  setSearchExpanded(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                accessibilityLabel="Search friends"
                testID="search-toggle"
              >
                <Search size={18} color="rgba(255,255,255,0.8)" strokeWidth={2} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => navigation.navigate('Groups')}
                accessibilityLabel="Groups"
                testID="groups-button"
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                    stroke="rgba(255,255,255,0.8)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  <Circle cx="9" cy="7" r="4" stroke="rgba(255,255,255,0.8)" strokeWidth={2} />
                  <Path
                    d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                    stroke="rgba(255,255,255,0.8)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </Svg>
              </TouchableOpacity>
              {isLoggedIn && (
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setAddFriendVisible(true)}
                  accessibilityLabel="Add friend"
                  testID="add-friend-button"
                >
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
                      stroke="rgba(255,255,255,0.8)"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                    <Circle cx="9" cy="7" r="4" stroke="rgba(255,255,255,0.8)" strokeWidth={2} />
                    <Path
                      d="M19 8v6M22 11h-6"
                      stroke="rgba(255,255,255,0.8)"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </Svg>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>

      <View style={styles.content}>
        {!isLoggedIn && filter !== 'contacts' ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Connect Nostr</Text>
            <Text style={styles.emptySubtitle}>
              Connect your Nostr identity to see your friends here.
            </Text>
            <TouchableOpacity
              style={styles.connectButton}
              onPress={() => navigation.getParent()?.dispatch({ type: 'OPEN_DRAWER' })}
            >
              <Text style={styles.connectButtonText}>Go to Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {availableLetters.length > 0 && (
              <AlphabetBar
                letters={availableLetters}
                currentLetter={currentLetter}
                onLetterPress={scrollToLetter}
              />
            )}
            <Profiler id="FriendsList" onRender={onProfilerRender}>
              <FlashList
                ref={flatListRef}
                data={combinedList}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Text style={styles.emptySubtitle}>
                      {search ? 'No contacts match your search.' : 'No contacts found.'}
                    </Text>
                  </View>
                }
                contentContainerStyle={styles.listContent}
                onScroll={handleScroll}
                // 32ms ≈ 2 frames at 60fps — keeps the alphabet-bar
                // highlight in sync with fast flings without firing the
                // handler every frame. The previous 250ms made the
                // highlight lag visibly on momentum scrolls.
                scrollEventThrottle={32}
              />
            </Profiler>
          </View>
        )}
      </View>

      <ContactProfileSheet
        visible={profileSheetVisible}
        onClose={() => {
          // Clear the staged contact alongside hiding the sheet so
          // re-opening with a different friend doesn't flash the
          // previous contact's banner / avatar / name before
          // handleContactPress restages the new selection.
          setProfileSheetVisible(false);
          setSelectedContact(null);
        }}
        contact={selectedContact}
        onViewFullProfile={handleViewFullProfile}
        canZap={hasWallets && !!selectedContact?.hasLightningAddress}
        zapDisabledReason={!hasWallets ? 'no wallet attached' : 'no Lightning address'}
        onZap={
          selectedContact
            ? () => {
                const target = selectedContact;
                setProfileSheetVisible(false);
                // handleZap re-resolves the verified Lightning address and
                // either zaps or explains why it can't.
                handleZap(target);
              }
            : undefined
        }
        onMessage={
          selectedContact?.pubkey
            ? () => {
                const item = selectedContact;
                if (!item || !item.pubkey) return;
                setProfileSheetVisible(false);
                setSelectedContact(null);
                navigation.navigate('Conversation', {
                  pubkey: item.pubkey,
                  name: item.name,
                  picture: item.picture,
                  lightningAddress: item.lightningAddress,
                });
              }
            : undefined
        }
      />

      <AddFriendSheet
        visible={addFriendVisible}
        onClose={() => setAddFriendVisible(false)}
        onAdd={handleAddFriend}
      />

      <AddContactCelebration
        visible={!!celebration}
        alreadyConnected={celebration?.alreadyConnected ?? false}
        name={celebDisplay.name}
        picture={celebDisplay.picture}
        onOpenProfile={handleCelebrationOpenProfile}
        onDismiss={() => setCelebration(null)}
      />

      <SendSheet
        visible={sendOpen}
        onClose={() => {
          setSendOpen(false);
          setZapTarget(null);
        }}
        initialAddress={zapTarget?.lightningAddress ?? undefined}
        initialPicture={zapTarget?.picture ?? undefined}
        recipientPubkey={zapTarget?.pubkey ?? undefined}
        recipientName={zapTarget?.name ?? undefined}
      />
    </View>
  );
};

export default FriendsScreen;
