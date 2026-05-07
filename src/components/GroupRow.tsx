import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import type { GroupSummary } from '../types/groups';
import { useNostr } from '../contexts/NostrContext';
import GroupAvatar, { type ContactInfo } from './GroupAvatar';
import { formatConversationTimestamp } from '../utils/conversationSummaries';

interface Props {
  summary: GroupSummary;
  // Receives `summary` so the parent can pass a single stable handler
  // reference across all rows (no fresh arrow per render). Without this,
  // React.memo's prop comparison saw a new onPress every render and
  // re-rendered the row even when its data hadn't changed (#300 follow-up).
  onPress?: (summary: GroupSummary) => void;
  /**
   * Optional precomputed pubkey → ContactInfo map shared with sibling
   * rows by the parent screen. Forwarded to GroupAvatar (for the avatar
   * cluster) and consulted directly here for the sender-name lookup —
   * so neither path iterates the contacts list per row. See issue #245.
   */
  contactInfoMap?: Map<string, ContactInfo>;
}

/** Resolve a friendly display name for a sender pubkey (kind-0 displayName
 * → name → petname → npub-prefix fallback). When a parent has supplied
 * `contactInfoMap` we read from it (O(1)); otherwise we fall back to a
 * linear scan of `contacts` (legacy path for non-list call sites). */
function senderName(
  pubkey: string,
  contactInfoMap: Map<string, ContactInfo> | undefined,
  contacts: ReturnType<typeof useNostr>['contacts'],
): string {
  const lc = pubkey.toLowerCase();
  const fromMap = contactInfoMap?.get(lc)?.name;
  if (fromMap) return fromMap;
  const c = contacts.find((x) => x.pubkey.toLowerCase() === lc);
  return (
    c?.profile?.displayName?.trim() ||
    c?.profile?.name?.trim() ||
    c?.petname?.trim() ||
    `${pubkey.slice(0, 8)}…`
  );
}

const GroupRow: React.FC<Props> = ({ summary, onPress, contactInfoMap }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { contacts, pubkey: myPubkey } = useNostr();
  const { group, activity } = summary;
  // Bind summary into the parent handler at the leaf so TouchableOpacity
  // sees a stable callback per render — see ConversationRow note.
  const handlePress = useMemo(
    () => (onPress ? () => onPress(summary) : undefined),
    [onPress, summary],
  );

  const timestamp = formatConversationTimestamp(activity.lastActivityAt);

  const preview = useMemo(() => {
    if (!activity.lastSenderPubkey || !activity.lastText) {
      return `${group.memberPubkeys.length + 1} member${group.memberPubkeys.length === 0 ? '' : 's'}`;
    }
    const isMe = myPubkey && activity.lastSenderPubkey === myPubkey.toLowerCase();
    const who = isMe ? 'You' : senderName(activity.lastSenderPubkey, contactInfoMap, contacts);
    return `${who}: ${activity.lastText}`;
  }, [activity, contacts, contactInfoMap, myPubkey, group.memberPubkeys.length]);

  // Avatar pubkeys: lead with recent senders so the people who've been
  // talking show up first. Top up from [viewer, ...members] so the cluster
  // size matches the actual people-count in the group (#363) — without
  // the viewer prefix, an inactive 1:1 group would render a single avatar
  // and a 3-person group only 2.
  const avatarPubkeys = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const pk of activity.recentSenderPubkeys) {
      const lc = pk.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      out.push(lc);
      if (out.length === 3) return out;
    }
    const fillSources = myPubkey ? [myPubkey, ...group.memberPubkeys] : group.memberPubkeys;
    for (const pk of fillSources) {
      const lc = pk.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      out.push(lc);
      if (out.length === 3) break;
    }
    return out;
  }, [activity.recentSenderPubkeys, group.memberPubkeys, myPubkey]);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={onPress ? 0.6 : 1}
      accessibilityLabel={`Open group ${group.name}`}
      testID={`group-row-${group.id}`}
    >
      <GroupAvatar
        pubkeys={avatarPubkeys}
        groupName={group.name}
        size={48}
        contactInfoMap={contactInfoMap}
      />
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
