import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import type { GroupSummary } from '../types/groups';
import { useNostr } from '../contexts/NostrContext';
import GroupAvatar from './GroupAvatar';
import { formatConversationTimestamp } from '../utils/conversationSummaries';

interface Props {
  summary: GroupSummary;
  onPress?: () => void;
}

/** Resolve a friendly display name for a sender pubkey (kind-0 displayName
 * → name → petname → npub-prefix fallback). Mirrors the logic in
 * conversationSummaries.fallbackName so previews read consistently. */
function senderName(pubkey: string, contacts: ReturnType<typeof useNostr>['contacts']): string {
  const c = contacts.find((x) => x.pubkey.toLowerCase() === pubkey.toLowerCase());
  return (
    c?.profile?.displayName?.trim() ||
    c?.profile?.name?.trim() ||
    c?.petname?.trim() ||
    `${pubkey.slice(0, 8)}…`
  );
}

const GroupRow: React.FC<Props> = ({ summary, onPress }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { contacts, pubkey: myPubkey } = useNostr();
  const { group, activity } = summary;

  const timestamp = formatConversationTimestamp(activity.lastActivityAt);

  const preview = useMemo(() => {
    if (!activity.lastSenderPubkey || !activity.lastText) {
      return `${group.memberPubkeys.length + 1} member${group.memberPubkeys.length === 0 ? '' : 's'}`;
    }
    const isMe = myPubkey && activity.lastSenderPubkey === myPubkey.toLowerCase();
    const who = isMe ? 'You' : senderName(activity.lastSenderPubkey, contacts);
    return `${who}: ${activity.lastText}`;
  }, [activity, contacts, myPubkey, group.memberPubkeys.length]);

  // Avatar pubkeys: prefer recent senders; if no messages yet, fall back
  // to the first 3 group members so the row still renders something
  // meaningful instead of just the letter avatar.
  const avatarPubkeys =
    activity.recentSenderPubkeys.length > 0
      ? activity.recentSenderPubkeys
      : group.memberPubkeys.slice(0, 3);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      accessibilityLabel={`Open group ${group.name}`}
      testID={`group-row-${group.id}`}
    >
      <GroupAvatar pubkeys={avatarPubkeys} groupName={group.name} size={48} />
      <View style={styles.info}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.timestamp} numberOfLines={1}>
            {timestamp}
          </Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      gap: 12,
    },
    info: {
      flex: 1,
      minWidth: 0,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    name: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    timestamp: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    preview: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
  });

export default React.memo(GroupRow);
