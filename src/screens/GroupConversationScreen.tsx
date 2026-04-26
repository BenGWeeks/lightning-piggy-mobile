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
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path, Circle } from 'react-native-svg';
import { LogOut, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useGroups } from '../contexts/GroupsContext';
import { useNostr, subscribeGroupMessages, notifyGroupMessage } from '../contexts/NostrContext';
import RenameGroupSheet from '../components/RenameGroupSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import AttachPanel from '../components/AttachPanel';
import GifPickerSheet from '../components/GifPickerSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import FriendPickerSheet, { PickedFriend } from '../components/FriendPickerSheet';
import { isConfigured as isGifConfigured, type Gif } from '../services/giphyService';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';
import { getCurrentLocation, formatGeoMessage } from '../services/locationService';
import { nprofileEncode, buildProfileRelayHints } from '../services/nostrService';
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
  const {
    contacts,
    sendGroupMessage,
    pubkey: myPubkey,
    refreshDmInbox,
    signEvent,
    relays,
  } = useNostr();
  const [renameVisible, setRenameVisible] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [selectedMemberPubkey, setSelectedMemberPubkey] = useState<string | null>(null);
  const [attachPanelOpen, setAttachPanelOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [invoiceSheetOpen, setInvoiceSheetOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
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

  // Live updates: NostrContext fires `subscribeGroupMessages` when an
  // inbound NIP-17 wrap decrypts to a kind-14 rumor that matches this
  // group's roster. Re-load from storage so we pick up the appended
  // entry (cheap — capped at 500 messages per group). We could be
  // smarter and merge in-memory, but file-of-truth simplicity wins.
  useEffect(() => {
    if (!group) return;
    const unsubscribe = subscribeGroupMessages((groupId) => {
      if (groupId !== group.id) return;
      loadGroupMessages(group.id).then((loaded) => {
        setMessages(loaded);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
      });
    });
    return unsubscribe;
  }, [group]);

  // Force-refresh the DM inbox on mount so the NIP-17 decrypt loop runs
  // and routes any pending kind-14 group rumors into local storage. The
  // `subscribeGroupMessages` hook above will then pick them up live.
  // Force-mode skips the `since` filter (NIP-59 wraps have a randomised
  // created_at — see refreshDmInbox's comment).
  useEffect(() => {
    if (!group) return;
    refreshDmInbox({ force: true }).catch(() => {});
  }, [group, refreshDmInbox]);

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

  // Single send-text path used by both the composer Send button and the
  // attach-panel actions (image-URL, location, GIF, etc.). Returns true
  // on success so callers can sequence post-send UI changes.
  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      if (!group || !myPubkey) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;
      setSending(true);
      const result = await sendGroupMessage({
        groupId: group.id,
        subject: group.name,
        memberPubkeys: group.memberPubkeys,
        text: trimmed,
      });
      setSending(false);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Unknown error');
        return false;
      }
      // Optimistically append locally with a `local_…` id. Duplicate
      // window vs the inbound self-wrap is documented as a known
      // follow-up (see PR #227 round-2 review thread).
      const local: GroupMessage = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderPubkey: myPubkey,
        text: trimmed,
        createdAt: Math.floor(Date.now() / 1000),
      };
      try {
        const next = await appendGroupMessage(group.id, local);
        setMessages(next);
        notifyGroupMessage(group.id, local);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
        return true;
      } catch (err) {
        if (__DEV__) console.warn('[GroupConversationScreen] appendGroupMessage failed:', err);
        Alert.alert(
          'Saved on relay, not on device',
          'Your message was sent, but we could not save it locally. Try again to refresh, or restart the app.',
        );
        return false;
      }
    },
    [group, myPubkey, sendGroupMessage],
  );

  const handleSend = useCallback(async () => {
    const ok = await sendText(draft);
    if (ok) setDraft('');
  }, [draft, sendText]);

  // Attach-panel actions. Each ends by closing the panel and (on
  // success) appending an optimistic local message via sendText. Image
  // and Photo go through the existing imageUploadService (Blossom →
  // URL) and send the URL as the message body — same as the 1:1 path.
  const closeAttachPanel = useCallback(() => setAttachPanelOpen(false), []);

  const uploadAndSend = useCallback(
    async (localUri: string, base64?: string | null) => {
      setUploadingImage(true);
      try {
        const scrubbed = await stripImageMetadata(localUri, base64);
        const url = await uploadImage(scrubbed.uri, signEvent, scrubbed.base64);
        await sendText(url);
      } catch (err) {
        Alert.alert('Upload failed', err instanceof Error ? err.message : 'Please try again.');
      } finally {
        setUploadingImage(false);
      }
    },
    [sendText, signEvent],
  );

  const handlePickAndSendImage = useCallback(async () => {
    if (uploadingImage || sending) return;
    closeAttachPanel();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSend(result.assets[0].uri, result.assets[0].base64);
  }, [uploadingImage, sending, closeAttachPanel, uploadAndSend]);

  const handleTakeAndSendPhoto = useCallback(async () => {
    if (uploadingImage || sending) return;
    closeAttachPanel();
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take and send photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSend(result.assets[0].uri, result.assets[0].base64);
  }, [uploadingImage, sending, closeAttachPanel, uploadAndSend]);

  const handleShareLocation = useCallback(async () => {
    if (sharingLocation) return;
    closeAttachPanel();
    setSharingLocation(true);
    try {
      const result = await getCurrentLocation();
      if (!result.ok) {
        Alert.alert('Could not share location', result.message);
        return;
      }
      await sendText(formatGeoMessage(result.location));
    } finally {
      setSharingLocation(false);
    }
  }, [sharingLocation, closeAttachPanel, sendText]);

  const handleSendGif = useCallback(
    async (gif: Gif) => {
      setGifPickerOpen(false);
      closeAttachPanel();
      await sendText(gif.url);
    },
    [closeAttachPanel, sendText],
  );

  // Share another contact's Nostr profile into the group. Mirrors the 1:1
  // path (ConversationScreen.handleShareContactPicked): "Shared contact:
  // <name>\nnostr:nprofile…" lets other Nostr clients render a tappable
  // profile mention. We send via the group's own sendText so the message
  // shows up in the group thread (not as a DM to the picked contact).
  const handleShareContactPicked = useCallback(
    async (friend: PickedFriend) => {
      setContactPickerOpen(false);
      closeAttachPanel();
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const relayHints = buildProfileRelayHints(friend.pubkey, contacts, readRelays);
      const nprofile = nprofileEncode(friend.pubkey, relayHints);
      const label = friend.name || 'a contact';
      await sendText(`Shared contact: ${label}\nnostr:${nprofile}`);
    },
    [closeAttachPanel, contacts, relays, sendText],
  );

  // ReceiveSheet hands us the bolt11 via `onSendToGroup`. We post it
  // directly via sendGroupMessage (NOT sendText) because sendText raises
  // its own Alert on failure — ReceiveSheet shows a Toast on failure as
  // well, and stacking both reads as a bug. Optimistic local append
  // mirrors what sendText does so the invoice shows up in the thread.
  const handleSendInvoiceToGroup = useCallback(
    async (payload: string): Promise<{ success: boolean; error?: string }> => {
      if (!group || !myPubkey) return { success: false, error: 'Group unavailable.' };
      const result = await sendGroupMessage({
        groupId: group.id,
        subject: group.name,
        memberPubkeys: group.memberPubkeys,
        text: payload,
      });
      if (!result.success) return { success: false, error: result.error ?? 'Send failed' };
      const local: GroupMessage = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderPubkey: myPubkey,
        text: payload,
        createdAt: Math.floor(Date.now() / 1000),
      };
      try {
        const next = await appendGroupMessage(group.id, local);
        setMessages(next);
        notifyGroupMessage(group.id, local);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
      } catch (err) {
        if (__DEV__) console.warn('[GroupConversationScreen] appendGroupMessage failed:', err);
      }
      return { success: true };
    },
    [group, myPubkey, sendGroupMessage],
  );

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

  // "Leave" not "Delete": this only removes the group from THIS device.
  // We don't publish a kind-30200 deletion event (and other members keep
  // the group in their local stores). True multi-party delete would
  // require either a NIP-09 event the receivers honour, or a kind-30200
  // tombstone — tracked as a follow-up.
  const handleLeave = () => {
    Alert.alert(
      'Leave group',
      `Remove "${group.name}" from this device? Other members will keep the group; you can be re-added if they message you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            await deleteGroup(group.id);
            navigation.goBack();
          },
        },
      ],
    );
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
            style={[styles.actionButton, styles.deleteIconButton]}
            onPress={handleLeave}
            accessibilityLabel="Leave group"
            testID="leave-group-button"
          >
            <LogOut size={18} color={colors.white} strokeWidth={2} />
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
              <TouchableOpacity
                style={styles.memberChip}
                onPress={() => setSelectedMemberPubkey(item.pubkey)}
                accessibilityLabel={`Open profile for ${item.name}`}
                testID={`member-chip-${item.pubkey.slice(0, 12)}`}
              >
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
              </TouchableOpacity>
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

        {attachPanelOpen ? (
          <AttachPanel
            onShareLocation={handleShareLocation}
            onSendImage={handlePickAndSendImage}
            onTakePhoto={handleTakeAndSendPhoto}
            onSendGif={isGifConfigured() ? () => setGifPickerOpen(true) : undefined}
            // Zap renders but stays disabled — there's no single recipient
            // to zap in a group, but hiding the tile entirely confused
            // users who expected the same set as 1:1 (#237).
            onSendZap={() => {}}
            zapDisabled
            onSendInvoice={() => {
              closeAttachPanel();
              setInvoiceSheetOpen(true);
            }}
            onShareContact={() => {
              // Picker opens over the panel; close on cancel/select.
              setContactPickerOpen(true);
            }}
          />
        ) : null}

        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setAttachPanelOpen((v) => !v)}
            disabled={sending || sharingLocation || uploadingImage}
            accessibilityLabel="Attach"
            testID="group-attach-button"
          >
            {sharingLocation || uploadingImage ? (
              <ActivityIndicator color={colors.brandPink} />
            ) : (
              <Plus size={22} color={colors.brandPink} />
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor={colors.textSupplementary}
            value={draft}
            onChangeText={setDraft}
            onFocus={closeAttachPanel}
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

      {/* Tap a member chip to open their profile sheet. The contact lookup
          uses the existing `contacts` (kind:3 follow list); for members we
          haven't yet fetched a profile for, the sheet falls back to a
          short-pubkey placeholder. */}
      <ContactProfileSheet
        visible={selectedMemberPubkey !== null}
        onClose={() => setSelectedMemberPubkey(null)}
        contact={
          selectedMemberPubkey
            ? (() => {
                const c = contacts.find((x) => x.pubkey === selectedMemberPubkey);
                return {
                  pubkey: selectedMemberPubkey,
                  name:
                    c?.profile?.displayName ||
                    c?.profile?.name ||
                    c?.petname ||
                    `${selectedMemberPubkey.slice(0, 8)}…`,
                  picture: c?.profile?.picture ?? null,
                  banner: c?.profile?.banner ?? null,
                  nip05: c?.profile?.nip05 ?? null,
                  lightningAddress: c?.profile?.lud16 ?? null,
                  source: 'nostr' as const,
                };
              })()
            : null
        }
      />

      <GifPickerSheet
        visible={gifPickerOpen}
        onClose={() => setGifPickerOpen(false)}
        onSelect={handleSendGif}
      />

      <FriendPickerSheet
        visible={contactPickerOpen}
        onClose={() => {
          // Closing the picker (cancel or pick) also closes the
          // AttachPanel underneath — same behaviour as 1:1 chats.
          setContactPickerOpen(false);
          setAttachPanelOpen(false);
        }}
        onSelect={handleShareContactPicked}
        title={`Share a contact with ${group.name}`}
        subtitle="They'll see it as a Nostr profile card they can open."
      />

      <ReceiveSheet
        visible={invoiceSheetOpen}
        onClose={() => setInvoiceSheetOpen(false)}
        presetGroup={{ id: group.id, name: group.name }}
        onSendToGroup={handleSendInvoiceToGroup}
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
    attachButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
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
