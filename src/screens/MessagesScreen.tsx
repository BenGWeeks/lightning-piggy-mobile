import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import ProfileIcon from '../components/ProfileIcon';
import ConversationRow from '../components/ConversationRow';
import ContactProfileSheet from '../components/ContactProfileSheet';
import FriendPickerSheet, { type PickedFriend } from '../components/FriendPickerSheet';
import {
  buildConversationSummaries,
  conversationPreview,
  type ConversationSummary,
} from '../utils/conversationSummaries';
import { styles } from '../styles/MessagesScreen.styles';
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
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<MessagesNavigation>();
  const { isLoggedIn, profile, contacts, refreshContacts } = useNostr();
  const { wallets } = useWallet();
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [anonSheetContact, setAnonSheetContact] = useState<AnonContact | null>(null);

  const conversationSummaries = useMemo(
    () => buildConversationSummaries(wallets, contacts),
    [wallets, contacts],
  );

  const filteredSummaries = useMemo(() => {
    if (!search.trim()) return conversationSummaries;
    const lower = search.toLowerCase();
    return conversationSummaries.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        conversationPreview(s).toLowerCase().includes(lower),
    );
  }, [conversationSummaries, search]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshContacts();
    setRefreshing(false);
  }, [refreshContacts]);

  const handleConversationPress = useCallback(
    (summary: ConversationSummary) => {
      const contact = summary.pubkey
        ? contacts.find((c) => c.pubkey === summary.pubkey)
        : undefined;
      const picture = summary.picture ?? contact?.profile?.picture ?? null;
      const lightningAddress = summary.lightningAddress ?? contact?.profile?.lud16 ?? null;
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
    [contacts, navigation],
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

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => (
      <ConversationRow summary={item} onPress={() => handleConversationPress(item)} />
    ),
    [handleConversationPress],
  );

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
            accessibilityLabel="Home"
            testID="messages-home-button"
          >
            <Image
              source={require('../../assets/images/Home.png')}
              style={styles.homeIcon}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <Text style={styles.title}>Messages</Text>
          <View style={{ flex: 1 }} />
          <ProfileIcon
            uri={profile?.picture}
            size={36}
            onPress={() => navigation.navigate('Account')}
          />
        </View>

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
            </>
          )}
        </View>
      </View>

      <View style={styles.content}>
        {!isLoggedIn ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Connect Nostr</Text>
            <Text style={styles.emptySubtitle}>
              Connect your Nostr identity to see your conversations here.
            </Text>
            <TouchableOpacity
              style={styles.connectButton}
              onPress={() => navigation.navigate('Account')}
            >
              <Text style={styles.connectButtonText}>Go to Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlashList
            data={filteredSummaries}
            keyExtractor={(item) => item.id}
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
            style={[styles.fab, { bottom: 24 + insets.bottom }]}
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
