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
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
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
import SendSheet from '../components/SendSheet';
import FriendPickerSheet, { PickedFriend } from '../components/FriendPickerSheet';
import MessageBubble from '../components/MessageBubble';
import { isConfigured as isGifConfigured, type Gif } from '../services/giphyService';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';
import {
  getCurrentLocation,
  formatGeoMessage,
  buildOsmViewUrl,
  type SharedLocation,
} from '../services/locationService';
import {
  fetchProfile,
  nprofileEncode,
  buildProfileRelayHints,
  DEFAULT_RELAYS,
} from '../services/nostrService';
import {
  appendGroupMessage,
  loadGroupMessages,
  type GroupMessage,
} from '../services/groupMessagesStorageService';
import {
  classifyMessageContent,
  extractSharedContact,
  type BubbleContent,
} from '../utils/messageContent';
import type { NostrProfile } from '../types/nostr';
import type { GroupConversationRoute, RootStackParamList } from '../navigation/types';
import type { CounterpartyContact } from '../components/TransactionDetailSheet';

type GroupConversationNavigation = NativeStackNavigationProp<
  RootStackParamList,
  'GroupConversation'
>;

// Pre-classified variant of GroupMessage — created in a useMemo so
// classifyMessageContent is NOT called inside the hot renderMessage path.
type ClassifiedMessage = GroupMessage & { content: BubbleContent };

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
  // Sheets surfaced by MessageBubble taps. Mirror the 1:1 conversation
  // wiring (ConversationScreen) so the rich-card affordances work the
  // same in groups.
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<string | null>(null);
  const [profileContact, setProfileContact] = useState<CounterpartyContact | null>(null);
  const [fullscreenGifUrl, setFullscreenGifUrl] = useState<string | null>(null);
  // Cache of kind-0 profiles for shared-contact cards. Populated by the
  // batch-fetch effect below, keyed by pubkey. `null` value = fetch
  // attempted and resolved with no profile (so MessageBubble can drop
  // the "Loading…" placeholder).
  const [sharedProfiles, setSharedProfiles] = useState<Record<string, NostrProfile | null>>({});
  // Tracks which pubkeys have already been scheduled for a kind-0 fetch
  // so the effect deps can be [messages] only (not [messages, sharedProfiles]).
  // Prevents a redundant re-run after every fetch batch writes sharedProfiles.
  const scheduledProfilePubkeys = useRef(new Set<string>());
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

  // MessageBubble handler — Pay button on an invoice / lightning address
  // bubble routes through SendSheet, same UX as 1:1 conversations.
  const handlePayInvoice = useCallback((raw: string) => {
    setInvoiceToPay(raw);
    setSendSheetOpen(true);
  }, []);

  // MessageBubble handler — opens ContactProfileSheet for the shared
  // contact, falling back to a short-pubkey placeholder when the kind-0
  // hasn't loaded yet (sharedProfiles fetch is below).
  const openSharedContact = useCallback((pk: string, profile: NostrProfile | null) => {
    const name = profile?.displayName || profile?.name || `${pk.slice(0, 8)}…`;
    setProfileContact({
      pubkey: pk,
      name,
      picture: profile?.picture ?? null,
      banner: profile?.banner ?? null,
      nip05: profile?.nip05 ?? null,
      lightningAddress: profile?.lud16 ?? null,
      source: 'nostr',
    });
  }, []);

  // MessageBubble handler — opens OSM in the system browser. Identical
  // to 1:1 conversation behaviour.
  const openLocation = useCallback((loc: SharedLocation) => {
    const url = buildOsmViewUrl(loc);
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', 'No browser is available to open OpenStreetMap.');
    });
  }, []);

  // Batch-fetch kind-0 profiles for every shared-contact reference in the
  // group thread. Mirrors the 1:1 path so contact cards render with avatar
  // + display name. Relay hints from the nprofile (when present) are
  // merged with DEFAULT_RELAYS so we still find the person if they
  // publish on niche relays.
  useEffect(() => {
    const byPubkey = new Map<string, Set<string>>();
    for (const m of messages) {
      const ref = extractSharedContact(m.text);
      if (!ref) continue;
      if (scheduledProfilePubkeys.current.has(ref.pubkey)) continue;
      const set = byPubkey.get(ref.pubkey) ?? new Set<string>();
      for (const r of ref.relays) set.add(r);
      byPubkey.set(ref.pubkey, set);
    }
    if (byPubkey.size === 0) return;
    // Mark all found pubkeys as scheduled before the async work starts so
    // a second messages-update doesn't re-queue the same fetches.
    for (const pk of byPubkey.keys()) scheduledProfilePubkeys.current.add(pk);
    let cancelled = false;
    (async () => {
      const updates: Record<string, NostrProfile | null> = {};
      await Promise.all(
        [...byPubkey.entries()].map(async ([pk, relaySet]) => {
          const mergedRelays = [...new Set([...DEFAULT_RELAYS, ...relaySet])];
          try {
            updates[pk] = await fetchProfile(pk, mergedRelays);
          } catch {
            updates[pk] = null;
          }
        }),
      );
      if (!cancelled) {
        setSharedProfiles((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages]);

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

  // Pre-classify message content once per messages update so renderMessage
  // (a FlatList renderItem) doesn't call classifyMessageContent on every
  // frame for every visible bubble. Mirror of ConversationScreen's items
  // useMemo which does the same classification.
  const classifiedMessages = useMemo<ClassifiedMessage[]>(
    () => messages.map((m) => ({ ...m, content: classifyMessageContent(m.text) })),
    [messages],
  );

  const renderMessage = useCallback(
    ({ item }: { item: ClassifiedMessage }) => {
      const fromMe = item.senderPubkey === myPubkey;
      const senderName = fromMe
        ? null
        : (memberNameByPubkey.get(item.senderPubkey) ?? `${item.senderPubkey.slice(0, 8)}…`);
      // Reuse the shared bubble — same renderer 1:1 chats use, so contact /
      // invoice / location / image / GIF cards all render identically across
      // chat types (#239). The classifier handles geo: + GIF detection up
      // front; image / invoice / lnaddr / contact ride on the text variant
      // and detect at render time.
      return (
        <MessageBubble
          id={item.id}
          fromMe={fromMe}
          createdAt={item.createdAt}
          content={item.content}
          senderName={senderName}
          sharedProfiles={sharedProfiles}
          onPayInvoice={handlePayInvoice}
          onPayLightningAddress={handlePayInvoice}
          onOpenContact={openSharedContact}
          onOpenLocation={openLocation}
          onOpenGifFullscreen={setFullscreenGifUrl}
          testIdPrefix="group-conversation"
        />
      );
    },
    [
      myPubkey,
      memberNameByPubkey,
      sharedProfiles,
      handlePayInvoice,
      openSharedContact,
      openLocation,
    ],
  );

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
            data={classifiedMessages}
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
        presetGroup={{ name: group.name }}
        onSendToGroup={handleSendInvoiceToGroup}
      />

      {/* Pay button on a received invoice routes to SendSheet pre-filled
          with the bolt11. Group invoices have no per-message wallet
          binding, so we leave initialPicture / recipientPubkey unset and
          let SendSheet decode the invoice for the destination. */}
      <SendSheet
        visible={sendSheetOpen}
        onClose={() => {
          setSendSheetOpen(false);
          setInvoiceToPay(null);
        }}
        initialAddress={invoiceToPay ?? undefined}
      />

      {/* Tap a shared-contact card → opens the contact's profile sheet.
          Distinct from the member-chip sheet above (selectedMemberPubkey)
          which opens for taps in the group header. Both are mutually
          exclusive in practice — the user can only tap one at a time. */}
      <ContactProfileSheet
        visible={profileContact !== null}
        onClose={() => setProfileContact(null)}
        contact={profileContact}
      />

      <Modal
        visible={fullscreenGifUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreenGifUrl(null)}
      >
        <Pressable
          style={styles.fullscreenBackdrop}
          onPress={() => setFullscreenGifUrl(null)}
          accessibilityLabel="Close full-screen GIF"
          testID="group-conversation-gif-fullscreen"
        >
          {fullscreenGifUrl ? (
            <ExpoImage
              source={{ uri: fullscreenGifUrl }}
              style={styles.fullscreenImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </Pressable>
      </Modal>
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
    // Bubble + per-message-type styles moved to src/components/MessageBubble
    // — both 1:1 and group screens render the same bubble component now.
    fullscreenBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    fullscreenImage: {
      width: '100%',
      height: '100%',
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
