import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  Alert,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../styles/theme';
import { useGroups } from '../contexts/GroupsContext';
import { useNostr } from '../contexts/NostrContext';
import RenameGroupSheet from '../components/RenameGroupSheet';
import type { GroupConversationRoute, RootStackParamList } from '../navigation/types';

type GroupConversationNavigation = NativeStackNavigationProp<
  RootStackParamList,
  'GroupConversation'
>;

interface MemberRow {
  pubkey: string;
  name: string;
  picture: string | null;
  lightningAddress: string | null;
}

const GroupConversationScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<GroupConversationNavigation>();
  const route = useRoute<GroupConversationRoute>();
  const { getGroup, deleteGroup } = useGroups();
  const { contacts } = useNostr();
  const [renameVisible, setRenameVisible] = useState(false);

  const group = getGroup(route.params.groupId);

  const members: MemberRow[] = useMemo(() => {
    if (!group) return [];
    const byPubkey = new Map(contacts.map((c) => [c.pubkey, c]));
    return group.memberPubkeys.map((pk) => {
      const c = byPubkey.get(pk);
      return {
        pubkey: pk,
        name:
          c?.profile?.displayName ||
          c?.profile?.name ||
          c?.petname ||
          `${pk.slice(0, 8)}...${pk.slice(-4)}`,
        picture: c?.profile?.picture ?? null,
        lightningAddress: c?.profile?.lud16 ?? null,
      };
    });
  }, [group, contacts]);

  if (!group) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.titleRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Back"
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
            <Text style={styles.title}>Group</Text>
          </View>
        </View>
        <View style={styles.content}>
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Group not found</Text>
            <Text style={styles.emptySubtitle}>This group may have been deleted.</Text>
          </View>
        </View>
      </View>
    );
  }

  const handleDelete = () => {
    Alert.alert('Delete group', `Are you sure you want to delete "${group.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteGroup(group.id);
          navigation.goBack();
        },
      },
    ]);
  };

  const renderMember = ({ item }: { item: MemberRow }) => (
    <View style={styles.memberRow}>
      <View style={styles.memberAvatar}>
        {item.picture ? (
          <Image source={{ uri: item.picture }} style={styles.memberAvatarImage} />
        ) : (
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
            <Path
              d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
              stroke={colors.textSupplementary}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        )}
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName} numberOfLines={1}>
          {item.name}
        </Text>
        {item.lightningAddress && (
          <Text style={styles.memberAddress} numberOfLines={1}>
            {item.lightningAddress}
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
            testID="group-back"
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
          <TouchableOpacity
            style={styles.titleTouch}
            onPress={() => setRenameVisible(true)}
            accessibilityLabel="Rename group"
            testID="group-title"
          >
            <Text style={styles.title} numberOfLines={1}>
              {group.name}
            </Text>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                stroke={colors.white}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setRenameVisible(true)}
            accessibilityLabel="Rename group"
            testID="rename-group-button"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                stroke={colors.white}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
        </View>
        <Text style={styles.memberCount}>
          {members.length} member{members.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.content}>
        <FlatList
          data={members}
          keyExtractor={(item) => item.pubkey}
          renderItem={renderMember}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptySubtitle}>No members in this group.</Text>
            </View>
          }
        />
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
          accessibilityLabel="Delete group"
          testID="delete-group-button"
        >
          <Text style={styles.deleteButtonText}>Delete Group</Text>
        </TouchableOpacity>
      </View>

      <RenameGroupSheet
        visible={renameVisible}
        groupId={group.id}
        onClose={() => setRenameVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brandPink,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  title: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
    flexShrink: 1,
  },
  memberCount: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    marginLeft: 48,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 20,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  memberAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textHeader,
  },
  memberAddress: {
    fontSize: 12,
    color: colors.textSupplementary,
    marginTop: 2,
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
  deleteButton: {
    marginHorizontal: 20,
    marginVertical: 20,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.red,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: colors.red,
    fontSize: 15,
    fontWeight: '700',
  },
});

export default GroupConversationScreen;
