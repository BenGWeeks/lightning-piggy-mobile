import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import ProfileIcon from '../components/ProfileIcon';
import ContactListItem from '../components/ContactListItem';
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
  lightningAddress: string | null;
  pubkey: string | null;
  source: 'nostr' | 'contacts';
}

const FriendsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<FriendsNavigation>();
  const { isLoggedIn, profile, contacts, refreshContacts } = useNostr();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<PhoneContact[]>([]);

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshContacts();
    const updated = await fetchPhoneContacts();
    setPhoneContacts(updated);
    setRefreshing(false);
  }, [refreshContacts]);

  const handleZap = useCallback(
    (item: ListItem) => {
      if (!item.lightningAddress) return;
      navigation.navigate('Home', {
        sendToAddress: item.lightningAddress,
        sendToName: item.name,
        sendToPicture: item.picture ?? undefined,
        sendToPubkey: item.pubkey ?? undefined,
      });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => (
      <ContactListItem
        name={item.name}
        picture={item.picture}
        lightningAddress={item.lightningAddress}
        onZap={item.lightningAddress ? () => handleZap(item) : undefined}
      />
    ),
    [handleZap],
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
          <FlatList
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
          />
        )}
      </View>
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
    paddingTop: 4,
    overflow: 'hidden',
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 20,
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
