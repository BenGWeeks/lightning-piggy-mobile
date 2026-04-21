import React, { useState, useMemo, useCallback, useEffect, useRef, Profiler } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  RefreshControl,
  Alert,
  GestureResponderEvent,
} from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import Svg, { Circle, Path } from 'react-native-svg';
import { Home } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../styles/theme';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import ProfileIcon from '../components/ProfileIcon';
import ContactListItem from '../components/ContactListItem';
import ContactProfileSheet from '../components/ContactProfileSheet';
import AddFriendSheet from '../components/AddFriendSheet';
import SendSheet from '../components/SendSheet';
import { fetchPhoneContacts, PhoneContact, setLightningAddress } from '../services/contactsService';
import { styles } from '../styles/FriendsScreen.styles';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';

type FriendsNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Friends'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Filter = 'all' | 'nostr' | 'contacts';

interface ListItem {
  id: string;
  name: string;
  picture: string | null;
  banner: string | null;
  nip05: string | null;
  lightningAddress: string | null;
  pubkey: string | null;
  source: 'nostr' | 'contacts';
}

const AlphabetBar: React.FC<{
  letters: string[];
  currentLetter: string | null;
  onLetterPress: (letter: string) => void;
}> = React.memo(
  ({ letters, currentLetter, onLetterPress }) => {
    const [tapped, setTapped] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onPressRef = useRef(onLetterPress);
    onPressRef.current = onLetterPress;

    const barRef = useRef<View>(null);
    const barLayout = useRef({ y: 0, height: 0 });
    const lastDragLetter = useRef<string | null>(null);

    useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    const handlePress = useCallback((letter: string) => {
      setTapped(letter);
      onPressRef.current(letter);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setTapped(null);
      }, 1500);
    }, []);

    const getLetterFromY = useCallback(
      (pageY: number) => {
        const { y, height } = barLayout.current;
        if (height === 0 || letters.length === 0) return null;
        const relY = pageY - y;
        const idx = Math.max(
          0,
          Math.min(Math.floor((relY / height) * letters.length), letters.length - 1),
        );
        return letters[idx];
      },
      [letters],
    );

    const handleTouchStart = useCallback((e: GestureResponderEvent) => {
      // Store absolute Y offset for drag calculations — don't scroll here,
      // let TouchableOpacity.onPress handle taps to avoid double-scroll
      const { locationY, pageY } = e.nativeEvent;
      barLayout.current.y = pageY - locationY;
      lastDragLetter.current = null;
    }, []);

    const handleTouchMove = useCallback(
      (e: GestureResponderEvent) => {
        const pageY = e.nativeEvent.pageY;
        const letter = getLetterFromY(pageY);
        if (letter && letter !== lastDragLetter.current) {
          lastDragLetter.current = letter;
          setTapped(letter);
          onPressRef.current(letter);
          if (timerRef.current) clearTimeout(timerRef.current);
        }
      },
      [getLetterFromY],
    );

    const handleTouchEnd = useCallback(() => {
      lastDragLetter.current = null;
      timerRef.current = setTimeout(() => setTapped(null), 1500);
    }, []);

    return (
      <View
        ref={barRef}
        style={styles.alphabetBar}
        accessibilityRole="list"
        accessibilityLabel="Alphabet index"
        onLayout={(e) => {
          barLayout.current.height = e.nativeEvent.layout.height;
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {letters.map((letter) => {
          const isActive = tapped === letter || (tapped === null && currentLetter === letter);
          return (
            <TouchableOpacity
              key={letter}
              style={[styles.alphabetLetterTouch, isActive && styles.alphabetLetterActive]}
              activeOpacity={0.7}
              onPress={() => handlePress(letter)}
              accessibilityRole="button"
              accessibilityLabel={`Jump to ${letter}`}
              testID={`alphabet-${letter}`}
            >
              <Text style={[styles.alphabetLetter, isActive && styles.alphabetLetterTextActive]}>
                {letter}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  },
  (prev, next) => {
    if (prev.currentLetter !== next.currentLetter) return false;
    if (prev.letters.length !== next.letters.length) return false;
    return prev.letters === next.letters || prev.letters.every((l, i) => l === next.letters[i]);
  },
);
AlphabetBar.displayName = 'AlphabetBar';

const FriendsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<FriendsNavigation>();
  const { isLoggedIn, profile, contacts, refreshContacts, addContact } = useNostr();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<PhoneContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<ListItem | null>(null);
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  const [addFriendVisible, setAddFriendVisible] = useState(false);
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

  useEffect(() => {
    fetchPhoneContacts()
      .then(setPhoneContacts)
      .catch(() => {});
  }, []);

  const combinedList = useMemo(() => {
    const items: ListItem[] = [];

    // Nostr contacts
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
          pubkey: c.pubkey,
          source: 'nostr',
        });
      }
    }

    // Phone contacts
    if (filter !== 'nostr') {
      for (const c of phoneContacts) {
        items.push({
          id: `phone-${c.id}`,
          name: c.name,
          picture: null,
          banner: null,
          nip05: null,
          lightningAddress: c.lightningAddress,
          pubkey: null,
          source: 'contacts',
        });
      }
    }

    // Filter by search
    let result = items;
    if (search.trim()) {
      const lower = search.toLowerCase();
      result = items.filter(
        (item) =>
          item.name.toLowerCase().includes(lower) ||
          (item.lightningAddress && item.lightningAddress.toLowerCase().includes(lower)),
      );
    }

    // Sort alphabetically
    result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return result;
  }, [contacts, phoneContacts, filter, search]);

  const flatListRef = useRef<FlashListRef<ListItem>>(null);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const item of combinedList) {
      const first = item.name.charAt(0).toUpperCase();
      if (/[A-Z]/.test(first)) {
        letters.add(first);
      } else {
        letters.add('#');
      }
    }
    return Array.from(letters).sort();
  }, [combinedList]);

  // Approximate item height for scroll-position letter tracking only (not used for layout)
  const ITEM_HEIGHT = 72;

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      if (scrollTrackingPaused.current) return;
      const offsetY = e.nativeEvent.contentOffset.y;
      const index = Math.floor(offsetY / ITEM_HEIGHT);
      if (index >= 0 && index < combinedList.length) {
        const first = combinedList[index].name.charAt(0).toUpperCase();
        const letter = /[A-Z]/.test(first) ? first : '#';
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
      const index = combinedList.findIndex((item) => {
        const first = item.name.charAt(0).toUpperCase();
        if (letter === '#') return !/[A-Z]/.test(first);
        return first === letter;
      });
      if (index >= 0) {
        // Pause scroll tracking to prevent currentLetter flashing during scroll
        scrollTrackingPaused.current = true;
        setCurrentLetter(letter);
        flatListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
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

  const handleZap = useCallback((item: ListItem) => {
    if (!item.lightningAddress) return;
    setZapTarget(item);
    setSendOpen(true);
  }, []);

  const handleContactPress = useCallback((item: ListItem) => {
    setSelectedContact(item);
    setProfileSheetVisible(true);
  }, []);

  const handleAddFriend = useCallback(
    async (npubOrHex: string) => {
      const result = await addContact(npubOrHex);
      if (!result.success) {
        Alert.alert('Error', result.error || 'Failed to add contact');
      }
      return result.success;
    },
    [addContact],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => (
      <ContactListItem
        name={item.name}
        picture={item.picture}
        lightningAddress={item.lightningAddress}
        onPress={() => handleContactPress(item)}
        onZap={item.lightningAddress ? () => handleZap(item) : undefined}
      />
    ),
    [handleZap, handleContactPress],
  );

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'nostr', label: 'Nostr' },
    { key: 'contacts', label: 'Contacts' },
  ];

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/friends-bg.png')}
        style={styles.bgImage}
        resizeMode="contain"
      />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            style={styles.homeButton}
            onPress={() => navigation.navigate('Home', {})}
            accessibilityLabel="Go home"
            testID="friends-home-button"
          >
            <Home size={20} color={colors.brandPink} />
          </TouchableOpacity>
          <Text style={styles.title}>Friends</Text>
          <View style={{ flex: 1 }} />
          <ProfileIcon
            uri={profile?.picture}
            size={36}
            onPress={() => navigation.navigate('Account')}
          />
        </View>

        {/* Filter chips + search toggle */}
        <View style={styles.chipRow}>
          {searchExpanded ? (
            <View style={styles.searchRow}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Circle cx="11" cy="11" r="8" stroke="rgba(255,255,255,0.7)" strokeWidth={2} />
                <Path
                  d="m21 21-4.3-4.3"
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
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
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M18 6 6 18M6 6l12 12"
                    stroke="rgba(255,255,255,0.8)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                </Svg>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {filters.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.chip, filter === f.key && styles.chipActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.searchToggle}
                onPress={() => {
                  setSearchExpanded(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                accessibilityLabel="Search friends"
                testID="search-toggle"
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Circle cx="11" cy="11" r="8" stroke="rgba(255,255,255,0.8)" strokeWidth={2} />
                  <Path
                    d="m21 21-4.3-4.3"
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
              onPress={() => navigation.navigate('Account')}
            >
              <Text style={styles.connectButtonText}>Go to Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {availableLetters.length > 1 && (
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
                scrollEventThrottle={250}
              />
            </Profiler>
          </View>
        )}
      </View>

      <ContactProfileSheet
        visible={profileSheetVisible}
        onClose={() => {
          setProfileSheetVisible(false);
          setSelectedContact(null);
        }}
        contact={selectedContact}
        onZap={
          selectedContact?.lightningAddress
            ? () => {
                setProfileSheetVisible(false);
                handleZap(selectedContact);
              }
            : undefined
        }
        onSetLightningAddress={
          selectedContact?.source === 'contacts'
            ? async (address: string) => {
                const phoneId = selectedContact.id.replace('phone-', '');
                await setLightningAddress(phoneId, address);
                setPhoneContacts((prev) =>
                  prev.map((c) => (c.id === phoneId ? { ...c, lightningAddress: address } : c)),
                );
                setSelectedContact((prev) =>
                  prev ? { ...prev, lightningAddress: address } : prev,
                );
              }
            : undefined
        }
      />

      <AddFriendSheet
        visible={addFriendVisible}
        onClose={() => setAddFriendVisible(false)}
        onAdd={handleAddFriend}
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
      />
    </View>
  );
};

export default FriendsScreen;
