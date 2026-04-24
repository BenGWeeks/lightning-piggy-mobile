import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Svg, { Circle, Path } from 'react-native-svg';
import { Users, Clock } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import ConversationRow from '../components/ConversationRow';
import ContactProfileSheet from '../components/ContactProfileSheet';
import FriendPickerSheet, { type PickedFriend } from '../components/FriendPickerSheet';
import { MessageCircle } from 'lucide-react-native';
import TabHeader from '../components/TabHeader';
import { colors } from '../styles/theme';
import {
  buildConversationSummaries,
  buildDmSummaries,
  conversationPreview,
  mergeSummaries,
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
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
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
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      const handle = InteractionManager.runAfterInteractions(() => refreshDmInbox());
      return () => handle.cancel();
    }, [isLoggedIn, refreshDmInbox]),
  );

  const followPubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) set.add(c.pubkey.toLowerCase());
    return set;
  }, [contacts]);

  const conversationSummaries = useMemo(() => {
    const zap = buildConversationSummaries(wallets, contacts);
    // Pass followPubkeys as a defence-in-depth filter. NostrContext's
    // refreshDmInbox already drops non-follows at the data layer, but
    // applying it again here guards against stale dmInbox state from
    // before a follow was revoked. The "Following only" rule is
    // load-bearing — keep it enforced everywhere a summary is built.
    const dm = buildDmSummaries(dmInbox, contacts, followPubkeys);
    return mergeSummaries(zap, dm);
  }, [wallets, contacts, dmInbox, followPubkeys]);

  // Following-only is always on by design (parental-control requirement);
  // enforcement lives inside buildDmSummaries + refreshDmInbox. This memo
  // applies the user-selectable time window + search, plus a defensive
  // follow check for pubkey'd zap rows so non-followed zap counterparties
  // don't slip in.
  const filteredSummaries = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - windowDays * 86400;
    let list = conversationSummaries.filter((s) => {
      if (s.lastActivityAt < cutoff) return false;
      if (s.pubkey && !followPubkeys.has(s.pubkey.toLowerCase())) return false;
      return true;
    });
    if (!search.trim()) return list;
    const lower = search.toLowerCase();
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        conversationPreview(s).toLowerCase().includes(lower),
    );
    return list;
  }, [conversationSummaries, search, followPubkeys, windowDays]);

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
      <TabHeader title="Messages" icon={<MessageCircle size={20} color={colors.brandPink} />} />
      <View style={styles.headerExtras}>
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
        {isLoggedIn && (
          <View style={styles.filterChipRow}>
            <View
              style={styles.filterChip}
              accessibilityLabel="Showing conversations from people you follow only"
              testID="messages-follows-indicator"
            >
              <Users size={14} color={colors.brandPink} />
              <Text style={styles.filterChipText}>Following only</Text>
            </View>
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
