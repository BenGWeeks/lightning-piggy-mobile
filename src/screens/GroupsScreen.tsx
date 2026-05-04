import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  InteractionManager,
} from 'react-native';
import { Alert } from '../components/BrandedAlert';
import Svg, { Path } from 'react-native-svg';
import { Users } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useGroups } from '../contexts/GroupsContext';
import { useNostr } from '../contexts/NostrContext';
import CreateGroupSheet from '../components/CreateGroupSheet';
import GroupAvatar, { type ContactInfo } from '../components/GroupAvatar';
import type { RootStackParamList } from '../navigation/types';
import type { Group } from '../types/groups';

type GroupsNavigation = NativeStackNavigationProp<RootStackParamList, 'Groups'>;

// Compose the avatar-cluster source: viewer first (so they show up even on
// inactive groups where there are no recent senders), then other members.
// Matches the "X people = X icons" mental model — memberPubkeys excludes
// the viewer by LP convention, so without prepending, a 1:1 group would
// render only 1 avatar and a 3-person group only 2. (#363)
function memberPubkeysWithViewer(myPubkey: string | null, memberPubkeys: string[]): string[] {
  return myPubkey ? [myPubkey, ...memberPubkeys] : memberPubkeys;
}

const GroupsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<GroupsNavigation>();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { visibleGroups, deleteGroup, followingOnly, setFollowingOnly, devMode } = useGroups();
  const { isLoggedIn, refreshDmInbox, contacts, pubkey: myPubkey } = useNostr();

  // Built once per render and shared by every row's GroupAvatar so we
  // do O(contacts) per render instead of O(rows × avatars × contacts).
  // Same idiom MessagesScreen uses (#245).
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
  const enforceFollowingOnly = followingOnly || !devMode;
  const [createVisible, setCreateVisible] = useState(false);

  // On focus, refresh the DM inbox so any new kind-1059 wraps get pulled
  // and the NIP-17 decrypt loop can route group rumors into the local
  // group store. Mirrors MessagesScreen's pattern (deferred via
  // InteractionManager so the tab transition stays smooth).
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      const handle = InteractionManager.runAfterInteractions(() =>
        refreshDmInbox({ force: true, includeNonFollows: !enforceFollowingOnly }),
      );
      return () => handle.cancel();
    }, [isLoggedIn, refreshDmInbox, enforceFollowingOnly]),
  );

  const openGroup = useCallback(
    (group: Group) => {
      navigation.navigate('GroupConversation', { groupId: group.id });
    },
    [navigation],
  );

  const handleLongPress = useCallback(
    (group: Group) => {
      Alert.alert(group.name, undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteGroup(group.id),
        },
      ]);
    },
    [deleteGroup],
  );

  const renderItem = useCallback(
    ({ item }: { item: Group }) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() => openGroup(item)}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.6}
        accessibilityLabel={`Open group ${item.name}`}
        testID={`group-row-${item.id}`}
      >
        <GroupAvatar
          pubkeys={memberPubkeysWithViewer(myPubkey, item.memberPubkeys)}
          groupName={item.name}
          size={44}
          contactInfoMap={contactInfoMap}
        />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {item.memberPubkeys.length + 1} member
            {item.memberPubkeys.length === 0 ? '' : 's'}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [openGroup, handleLongPress, styles, contactInfoMap, myPubkey],
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
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
            testID="groups-back"
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="m15 18-6-6 6-6"
                stroke={colors.brandPink}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.title}>Groups</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setCreateVisible(true)}
            accessibilityLabel="Create group"
            testID="create-group-button"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 5v14M5 12h14"
                stroke={colors.white}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.filterChipRow}>
          {devMode ? (
            <TouchableOpacity
              style={followingOnly ? styles.filterChip : styles.filterChipOff}
              onPress={() => setFollowingOnly(!followingOnly)}
              accessibilityLabel={
                followingOnly
                  ? 'Following-only filter on. Tap to show all groups.'
                  : 'Following-only filter off. Tap to filter to followed members only.'
              }
              accessibilityRole="button"
              testID="groups-follows-toggle"
            >
              <Users
                size={14}
                color={followingOnly ? colors.brandPink : colors.textSupplementary}
              />
              <Text style={followingOnly ? styles.filterChipText : styles.filterChipTextOff}>
                {followingOnly ? 'Following only' : 'All groups (dev)'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View
              style={styles.filterChip}
              accessibilityLabel="Showing groups with at least one followed member"
              testID="groups-follows-indicator"
            >
              <Users size={14} color={colors.brandPink} />
              <Text style={styles.filterChipText}>Following only</Text>
            </View>
          )}
        </View>
        {visibleGroups.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySubtitle}>
              Create a group to chat with multiple friends at once.
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => setCreateVisible(true)}
              accessibilityLabel="Create your first group"
              testID="create-first-group"
            >
              <Text style={styles.emptyButtonText}>Create Group</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={visibleGroups}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      <CreateGroupSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(group) => navigation.navigate('GroupConversation', { groupId: group.id })}
      />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
    },
    bgImage: {
      position: 'absolute',
      width: '120%',
      height: 420,
      right: -40,
      top: -20,
      opacity: 0.15,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    addButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.2)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: colors.white,
      fontSize: 28,
      fontWeight: '700',
    },
    content: {
      flex: 1,
      backgroundColor: colors.white,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -24,
    },
    filterChipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
      marginLeft: 16,
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: 'rgba(229, 34, 120, 0.1)',
    },
    filterChipOff: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      borderWidth: 1,
      borderColor: 'rgba(0, 0, 0, 0.1)',
    },
    filterChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.brandPink,
    },
    filterChipTextOff: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    listContent: {
      paddingTop: 12,
      paddingBottom: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 12,
    },
    info: {
      flex: 1,
    },
    name: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    emptyState: {
      padding: 40,
      alignItems: 'center',
      gap: 8,
      marginTop: 40,
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
    emptyButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 8,
    },
    emptyButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default GroupsScreen;
