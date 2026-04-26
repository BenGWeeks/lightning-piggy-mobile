import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useGroups } from '../contexts/GroupsContext';
import { useNostr } from '../contexts/NostrContext';
import RenameGroupSheet from '../components/RenameGroupSheet';
import {
  appendGroupMessage,
  loadGroupMessages,
  type GroupMessage,
} from '../services/groupMessagesStorageService';
import type { GroupConversationRoute, RootStackParamList } from '../navigation/types';

type GroupConversationNavigation = NativeStackNavigationProp<
  RootStackParamList,
  'GroupConversation'
>;

interface MemberRow {
  pubkey: string;
  name: string;
  picture: string | null;
}

const GroupConversationScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<GroupConversationNavigation>();
  const route = useRoute<GroupConversationRoute>();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { getGroup, deleteGroup } = useGroups();
  const { contacts, sendGroupMessage, pubkey: myPubkey } = useNostr();
  const [renameVisible, setRenameVisible] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const listRef = useRef<FlatList<GroupMessage>>(null);

  const group = getGroup(route.params.groupId);

  // Load persisted local messages on mount / when navigating back.
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    loadGroupMessages(group.id)
      .then((loaded) => {
        if (!cancelled) {
          setMessages(loaded);
          setLoadingMessages(false);
          // Defer scroll to next tick so FlatList has laid out.
          setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 0);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group]);

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
      };
    });
  }, [group, contacts]);

  const memberNameByPubkey = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.pubkey, m.name);
    if (myPubkey) map.set(myPubkey, 'You');
    return map;
  }, [members, myPubkey]);

  const handleSend = useCallback(async () => {
    if (!group || !myPubkey) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const result = await sendGroupMessage({
      groupId: group.id,
      subject: group.name,
      memberPubkeys: group.memberPubkeys,
      text,
    });
    setSending(false);
    if (!result.success) {
      Alert.alert('Send failed', result.error ?? 'Unknown error');
      return;
    }
    setDraft('');
    // Optimistically append locally — inbound NIP-17 routing for groups
    // is tracked as a follow-up; for now the sender's own copy is the
    // source of truth on this device.
    const local: GroupMessage = {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      senderPubkey: myPubkey,
      text,
      createdAt: Math.floor(Date.now() / 1000),
    };
    const next = await appendGroupMessage(group.id, local);
    setMessages(next);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
  }, [draft, group, myPubkey, sendGroupMessage]);

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

  const renderMessage = ({ item }: { item: GroupMessage }) => {
    const fromMe = item.senderPubkey === myPubkey;
    const senderName =
      memberNameByPubkey.get(item.senderPubkey) ?? `${item.senderPubkey.slice(0, 8)}…`;
    return (
      <View style={[styles.messageRow, fromMe ? styles.messageRowMe : styles.messageRowOther]}>
        <View
          style={[
            styles.messageBubble,
            fromMe ? styles.messageBubbleMe : styles.messageBubbleOther,
          ]}
        >
          {!fromMe && <Text style={styles.messageSender}>{senderName}</Text>}
          <Text style={fromMe ? styles.messageTextMe : styles.messageTextOther}>{item.text}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
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
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteIconButton]}
            onPress={handleDelete}
            accessibilityLabel="Delete group"
            testID="delete-group-button"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"
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
        {/* Member chips so the test can verify membership without scrolling
            off-screen on small devices. */}
        <View style={styles.membersStrip}>
          <FlatList
            data={members}
            keyExtractor={(item) => item.pubkey}
            renderItem={({ item }) => (
              <View style={styles.memberChip} testID={`member-chip-${item.pubkey.slice(0, 12)}`}>
                <View style={styles.memberAvatar}>
                  {item.picture ? (
                    <Image source={{ uri: item.picture }} style={styles.memberAvatarImage} />
                  ) : (
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
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
                <Text style={styles.memberChipName} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
            )}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.membersStripContent}
          />
        </View>

        {loadingMessages ? (
          <ActivityIndicator color={colors.brandPink} style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
            testID="group-messages-list"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptySubtitle}>No messages yet. Say hi!</Text>
              </View>
            }
          />
        )}

        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor={colors.textSupplementary}
            value={draft}
            onChangeText={setDraft}
            multiline
            accessibilityLabel="Group message input"
            testID="group-message-input"
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            accessibilityLabel="Send group message"
            testID="group-send-button"
          >
            {sending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
                  stroke={colors.white}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <RenameGroupSheet
        visible={renameVisible}
        groupId={group.id}
        onClose={() => setRenameVisible(false)}
      />
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
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
      fontSize: 22,
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
    deleteIconButton: {
      backgroundColor: 'rgba(0,0,0,0.15)',
    },
    content: {
      flex: 1,
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -24,
      overflow: 'hidden',
    },
    membersStrip: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      paddingTop: 12,
      paddingBottom: 12,
    },
    membersStripContent: {
      paddingHorizontal: 16,
      gap: 10,
    },
    memberChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 18,
      backgroundColor: colors.surface,
      gap: 8,
      maxWidth: 180,
    },
    memberAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    memberAvatarImage: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    memberChipName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textHeader,
      flexShrink: 1,
    },
    messagesList: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      gap: 6,
      flexGrow: 1,
    },
    messageRow: {
      flexDirection: 'row',
      marginVertical: 3,
    },
    messageRowMe: {
      justifyContent: 'flex-end',
    },
    messageRowOther: {
      justifyContent: 'flex-start',
    },
    messageBubble: {
      maxWidth: '78%',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 16,
    },
    messageBubbleMe: {
      backgroundColor: colors.brandPink,
      borderBottomRightRadius: 4,
    },
    messageBubbleOther: {
      backgroundColor: colors.surface,
      borderBottomLeftRadius: 4,
    },
    messageSender: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.brandPink,
      marginBottom: 2,
    },
    messageTextMe: {
      color: colors.white,
      fontSize: 15,
    },
    messageTextOther: {
      color: colors.textBody,
      fontSize: 15,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 12,
      paddingTop: 8,
      gap: 8,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      backgroundColor: colors.background,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textBody,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.4,
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
  });

export default GroupConversationScreen;
