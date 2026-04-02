import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  RefreshControl,
  PanResponder,
  Alert,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import ProfileIcon from '../components/ProfileIcon';
import ContactListItem from '../components/ContactListItem';
import ContactProfileSheet from '../components/ContactProfileSheet';
import AddFriendSheet from '../components/AddFriendSheet';
import SendSheet from '../components/SendSheet';
import { fetchPhoneContacts, PhoneContact } from '../services/contactsService';
import { colors } from '../styles/theme';
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

const FriendsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<FriendsNavigation>();
  const { isLoggedIn, profile, contacts, refreshContacts, addContact } = useNostr();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<PhoneContact[]>([]);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<ListItem | null>(null);
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  const [addFriendVisible, setAddFriendVisible] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [zapTarget, setZapTarget] = useState<ListItem | null>(null);

  useEffect(() => {
    fetchPhoneContacts().then(setPhoneContacts);
  }, []);

  const combinedList = useMemo(() => {
    const items: ListItem[] = [];

    // Nostr contacts
    if (filter !== 'contacts') {
      for (const c of contacts) {
        items.push({
          id: `nostr-${c.pubkey}`,
          name: c.profile?.displayName || c.profile?.name || c.petname || c.pubkey.slice(0, 12),
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

  const flatListRef = useRef<FlatList>(null);
  const alphabetBarRef = useRef<View>(null);
  const alphabetBarLayout = useRef({ y: 0, height: 0 });

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

  const ITEM_HEIGHT = 72;

  const scrollToLetter = useCallback(
    (letter: string) => {
      const index = combinedList.findIndex((item) => {
        const first = item.name.charAt(0).toUpperCase();
        if (letter === '#') return !/[A-Z]/.test(first);
        return first === letter;
      });
      if (index >= 0) {
        flatListRef.current?.scrollToOffset({ offset: index * ITEM_HEIGHT, animated: false });
      }
    },
    [combinedList],
  );

  const lastScrolledLetter = useRef<string | null>(null);

  const getLetterFromPageY = useCallback(
    (pageY: number) => {
      const { y, height } = alphabetBarLayout.current;
      if (height === 0 || availableLetters.length === 0) return null;
      const relativeY = pageY - y;
      const letterHeight = height / availableLetters.length;
      const idx = Math.max(
        0,
        Math.min(Math.floor(relativeY / letterHeight), availableLetters.length - 1),
      );
      return availableLetters[idx];
    },
    [availableLetters],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          // Re-measure on every touch to ensure accuracy
          alphabetBarRef.current?.measureInWindow((_x, y, _w, h) => {
            if (h > 0) {
              alphabetBarLayout.current = { y, height: h };
            }
            const letter = getLetterFromPageY(evt.nativeEvent.pageY);
            if (letter) {
              setActiveLetter(letter);
              if (letter !== lastScrolledLetter.current) {
                lastScrolledLetter.current = letter;
                scrollToLetter(letter);
              }
            }
          });
        },
        onPanResponderMove: (evt) => {
          const letter = getLetterFromPageY(evt.nativeEvent.pageY);
          if (letter) {
            setActiveLetter(letter);
            if (letter !== lastScrolledLetter.current) {
              lastScrolledLetter.current = letter;
              scrollToLetter(letter);
            }
          }
        },
        onPanResponderRelease: () => {
          lastScrolledLetter.current = null;
          setActiveLetter(null);
        },
      }),
    [getLetterFromPageY, scrollToLetter],
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
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            style={styles.homeButton}
            onPress={() => navigation.navigate('Home', {})}
          >
            <Image
              source={require('../../assets/images/Home.png')}
              style={styles.homeIcon}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <Text style={styles.title}>Friends</Text>
          {isLoggedIn && (
            <TouchableOpacity style={styles.addButton} onPress={() => setAddFriendVisible(true)}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
                  stroke={colors.brandPink}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <Circle cx="9" cy="7" r="4" stroke={colors.brandPink} strokeWidth={2} />
                <Path
                  d="M19 8v6M22 11h-6"
                  stroke={colors.brandPink}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <ProfileIcon
            uri={profile?.picture}
            size={36}
            onPress={() => navigation.navigate('Account')}
          />
        </View>

        {/* Filter chips */}
        <View style={styles.chipRow}>
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
        </View>

        {/* Search bar */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Circle cx="11" cy="11" r="8" stroke="rgba(255,255,255,0.5)" strokeWidth={2} />
            <Path
              d="m21 21-4.3-4.3"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
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
              <View
                ref={alphabetBarRef}
                style={styles.alphabetBar}
                onLayout={() => {
                  alphabetBarRef.current?.measureInWindow((_x, y, _w, h) => {
                    if (h > 0) {
                      alphabetBarLayout.current = { y, height: h };
                    }
                  });
                }}
                {...panResponder.panHandlers}
              >
                {availableLetters.map((letter) => (
                  <View
                    key={letter}
                    style={[
                      styles.alphabetLetterTouch,
                      activeLetter === letter && styles.alphabetLetterActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.alphabetLetter,
                        activeLetter === letter && styles.alphabetLetterTextActive,
                      ]}
                    >
                      {letter}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <FlatList
              ref={flatListRef}
              data={combinedList}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptySubtitle}>
                    {search ? 'No contacts match your search.' : 'No contacts found.'}
                  </Text>
                </View>
              }
              contentContainerStyle={styles.listContent}
              onScrollToIndexFailed={() => {}}
              style={{ flex: 1 }}
            />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.brandPink,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  homeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  homeIcon: {
    width: 20,
    height: 20,
    tintColor: colors.brandPink,
  },
  title: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  chipActive: {
    backgroundColor: colors.white,
  },
  chipText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.brandPink,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.white,
    fontWeight: '500',
  },
  content: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -12,
    paddingTop: 12,
    overflow: 'hidden',
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 20,
  },
  alphabetBar: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    width: 28,
  },
  alphabetLetterTouch: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alphabetLetterActive: {
    backgroundColor: colors.divider,
  },
  alphabetLetter: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSupplementary,
    textAlign: 'center',
  },
  alphabetLetterTextActive: {
    color: colors.brandPink,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textHeader,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSupplementary,
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: colors.brandPink,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  connectButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});

export default FriendsScreen;
