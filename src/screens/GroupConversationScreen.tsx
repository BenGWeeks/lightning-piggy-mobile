import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import { Alert } from '../components/BrandedAlert';
import {
  KeyboardController,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { LogOut } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createGroupConversationScreenStyles } from '../styles/GroupConversationScreen.styles';
import { useGroups } from '../contexts/GroupsContext';
import { useNostr, useNostrContacts, subscribeGroupMessages } from '../contexts/NostrContext';
import { useGroupComposerActions } from '../hooks/useGroupComposerActions';
import RenameGroupSheet from '../components/RenameGroupSheet';
import GroupMembersSheet from '../components/GroupMembersSheet';
import AttachPanel from '../components/AttachPanel';
import ConversationComposer from '../components/ConversationComposer';
import BrandGradientBackground from '../components/BrandGradientBackground';
import GifPickerSheet from '../components/GifPickerSheet';
import PollComposerSheet from '../components/PollComposerSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import VoiceRecordingSheet from '../components/VoiceRecordingSheet';
import SendSheet from '../components/SendSheet';
import FriendPickerSheet from '../components/FriendPickerSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import MessageBubble from '../components/MessageBubble';
import DeliveryDetailSheet from '../components/DeliveryDetailSheet';
import { useMessageInfoSheet } from '../hooks/useMessageInfoSheet';
import SecretModeCelebration from '../components/SecretModeCelebration';
import { isConfigured as isGifConfigured } from '../services/giphyService';
import { buildOsmViewUrl, type SharedLocation } from '../services/locationService';
import { fetchProfile, DEFAULT_RELAYS } from '../services/nostrService';
import { loadGroupMessages, type GroupMessage } from '../services/groupMessagesStorageService';
import {
  classifyMessageContent,
  deriveGroupWireKind,
  extractSharedContact,
  type BubbleContent,
} from '../utils/messageContent';
import { buildPollMessage, buildVoteMessage, parsePoll, parseVote } from '../utils/pollMessage';
import {
  legacyPollToStored,
  tallyPoll,
  type PollTally,
  type StoredPoll,
  type VoteRecord,
} from '../utils/nip88Poll';
import { sanitizeDisplayText } from '../utils/sanitizeDisplayText';
import { usePaidInvoiceTracker } from '../hooks/usePaidInvoiceTracker';
import type { NostrProfile } from '../types/nostr';
import type { GroupConversationRoute, RootStackParamList } from '../navigation/types';

type GroupConversationNavigation = NativeStackNavigationProp<
  RootStackParamList,
  'GroupConversation'
>;

// Pre-classified variant of GroupMessage — created in a useMemo so
// classifyMessageContent is NOT called inside the hot renderMessage path.
type ClassifiedMessage = GroupMessage & { content: BubbleContent; wireKind: 14 | 15 };

interface MemberRow {
  pubkey: string;
  name: string;
  picture: string | null;
}

const GroupConversationScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  // The composer's own keyboard wiring lives in ConversationComposer
  // (#251). The screen ALSO listens to the keyboard so the FlatList
  // shrinks by the keyboard height when the IME opens — without this
  // the bottom bubbles render under the keyboard because
  // KeyboardStickyView only translates the composer visually, it
  // doesn't reduce the FlatList's layout footprint (#470).
  const keyboard = useReanimatedKeyboardAnimation();
  const animatedListLiftStyle = useAnimatedStyle(() => ({
    marginBottom: -keyboard.height.value,
  }));
  const navigation = useNavigation<GroupConversationNavigation>();
  const route = useRoute<GroupConversationRoute>();
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createGroupConversationScreenStyles(colors), [colors]);
  const { getGroup, deleteGroup, secretMode, setSecretMode } = useGroups();
  const { pubkey: myPubkey, profile: myProfile } = useNostr();
  const { contacts } = useNostrContacts();
  const [renameVisible, setRenameVisible] = useState(false);
  const [membersSheetVisible, setMembersSheetVisible] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [attachPanelOpen, setAttachPanelOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [invoiceSheetOpen, setInvoiceSheetOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  // Sheets surfaced by MessageBubble taps. Mirror the 1:1 conversation
  // wiring (ConversationScreen) so the rich-card affordances work the
  // same in groups.
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<string | null>(null);
  const [fullscreenGifUrl, setFullscreenGifUrl] = useState<string | null>(null);
  // Secret Mode chat-trigger card overlay state. Mirrors the 1:1
  // wiring in ConversationScreen — owned at screen level so the
  // celebration confetti renders once over the group conversation,
  // not per bubble cell.
  const [secretCelebrationVisible, setSecretCelebrationVisible] = useState(false);
  const [secretPendingEnabled, setSecretPendingEnabled] = useState(false);
  const handleToggleSecretMode = useCallback(() => {
    const next = !secretMode;
    setSecretMode(next);
    setSecretPendingEnabled(next);
    setSecretCelebrationVisible(true);
  }, [secretMode, setSecretMode]);
  // Contact preview sheet — peek a member or shared contact without
  // leaving the group conversation. The sheet's "View full profile"
  // link drills into ContactProfile when the user wants the deep view.
  const [sheetContact, setSheetContact] = useState<ContactProfileBodyData | null>(null);
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  // Cache of kind-0 profiles for shared-contact cards. Populated by the
  // batch-fetch effect below, keyed by pubkey. `null` value = fetch
  // attempted and resolved with no profile (so MessageBubble can drop
  // the "Loading…" placeholder).
  const [sharedProfiles, setSharedProfiles] = useState<Record<string, NostrProfile | null>>({});
  // Tracks which pubkeys have already been scheduled for a kind-0 fetch
  // so the effect deps can be [messages] only (not [messages, sharedProfiles]).
  // Prevents a redundant re-run after every fetch batch writes sharedProfiles.
  const scheduledProfilePubkeys = useRef(new Set<string>());
  const listRef = useRef<FlatList<ClassifiedMessage>>(null);

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

  // NOTE: We used to call refreshDmInbox({ force: true }) on mount here
  // to drain any pending kind-14 group rumors before the live subscription
  // kicked in. That cost 3-25 s of JS-thread blocking depending on inbox
  // size — perceived as freeze on back-tap (#286). The live subscription
  // (`subscribeGroupMessages` above) handles delivery for any wraps that
  // land while the screen is open; missed wraps from before mount get
  // drained on the next MessagesScreen focus or app-foreground refresh.

  // Stored `memberPubkeys` excludes the viewer by LP convention (see
  // GroupsContext). For display we re-include self pinned at the top so
  // the header count and the members sheet reflect the true group size,
  // matching Signal / WhatsApp / Telegram (#473). The "You" suffix on
  // the self row is wired via `memberNameByPubkey` below + the sheet's
  // own self-row marker.
  const members: MemberRow[] = useMemo(() => {
    if (!group) return [];
    const byPubkey = new Map(contacts.map((c) => [c.pubkey, c]));
    // Dedupe against self (case-insensitive) before mapping. Defends
    // against legacy / accidentally-self-included memberPubkeys lists
    // that would otherwise produce a double "You" row + an off-by-one
    // header count.
    const myLower = myPubkey?.toLowerCase();
    const others: MemberRow[] = group.memberPubkeys
      .filter((pk) => !myLower || pk.toLowerCase() !== myLower)
      .map((pk) => {
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
    if (!myPubkey) return others;
    const selfRow: MemberRow = {
      pubkey: myPubkey,
      name:
        myProfile?.displayName ||
        myProfile?.name ||
        `${myPubkey.slice(0, 8)}...${myPubkey.slice(-4)}`,
      picture: myProfile?.picture ?? null,
    };
    return [selfRow, ...others];
  }, [group, contacts, myPubkey, myProfile]);

  const memberNameByPubkey = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.pubkey, m.name);
    if (myPubkey) map.set(myPubkey, t('groupConversationScreen.you'));
    return map;
  }, [members, myPubkey, t]);

  // Send / upload / share orchestration + in-flight flags live in the
  // useGroupComposerActions hook (parallel to the 1:1 screen's
  // useConversationComposerActions). Everything funnels through the hook's
  // sendText (optimistic append + scroll).
  const {
    sending,
    uploadingImage,
    sharingLocation,
    uploadingVoice,
    sendText,
    handleSend,
    handlePickAndSendImage,
    handleTakeAndSendPhoto,
    handleShareLocation,
    handleSendGif,
    handleShareContactPicked,
    handleSendInvoiceToGroup,
    handleSendVoiceNote,
    resendText,
  } = useGroupComposerActions({
    group,
    draft,
    setDraft,
    setMessages,
    scrollToEnd: () => listRef.current?.scrollToEnd({ animated: true }),
    setAttachPanelOpen,
    setGifPickerOpen,
    setContactPickerOpen,
    setVoiceSheetOpen,
  });

  // Tap a group bubble → the same message-info sheet 1:1 chats use (#856).
  // Group sends aren't per-relay tracked (no delivery store), so the sheet
  // shows the protocol/kind/event-id metadata + a Re-publish for sent text.
  const {
    info: messageSheetInfo,
    showInfo: handleShowInfo,
    closeInfo: closeMessageInfo,
    resendFromInfo: handleResendFromInfo,
    canResend: canResendFromInfo,
  } = useMessageInfoSheet(resendText);

  const closeAttachPanel = useCallback(() => setAttachPanelOpen(false), []);
  // Mirror ConversationScreen's openAttachPanel: dismiss the IME first
  // so the panel + composer + keyboard never have to stack. Without this,
  // tapping the attach button while the message input is focused leaves
  // the keyboard up, forcing the sticky layout to compete with the IME.
  const openAttachPanel = useCallback(() => {
    setAttachPanelOpen(true);
    KeyboardController.dismiss();
  }, []);

  // MessageBubble handler — Pay button on an invoice / lightning address
  // bubble routes through SendSheet, same UX as 1:1 conversations.
  const handlePayInvoice = useCallback((raw: string) => {
    setInvoiceToPay(raw);
    setSendSheetOpen(true);
  }, []);

  const presentContactSheet = useCallback((contact: ContactProfileBodyData) => {
    setSheetContact(contact);
    setProfileSheetVisible(true);
  }, []);
  const handleViewFullProfile = useCallback(() => {
    if (!sheetContact) return;
    setProfileSheetVisible(false);
    navigation.navigate('ContactProfile', { contact: sheetContact });
  }, [sheetContact, navigation]);

  // MessageBubble handler — open the contact preview sheet for the
  // shared contact, falling back to a short-pubkey placeholder when
  // the kind-0 hasn't loaded yet (sharedProfiles fetch is below).
  const openSharedContact = useCallback(
    (pk: string, profile: NostrProfile | null) => {
      const name = profile?.displayName || profile?.name || `${pk.slice(0, 8)}…`;
      presentContactSheet({
        pubkey: pk,
        name,
        picture: profile?.picture ?? null,
        banner: profile?.banner ?? null,
        nip05: profile?.nip05 ?? null,
        lightningAddress: profile?.lud16 ?? null,
        source: 'nostr',
      });
    },
    [presentContactSheet],
  );

  // MessageBubble handler — opens OSM in the system browser. Identical
  // to 1:1 conversation behaviour.
  const openLocation = useCallback(
    (loc: SharedLocation) => {
      const url = buildOsmViewUrl(loc);
      Linking.openURL(url).catch(() => {
        Alert.alert(
          t('groupConversationScreen.couldNotOpenLinkTitle'),
          t('groupConversationScreen.couldNotOpenLinkMessage'),
        );
      });
    },
    [t],
  );

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

  // Pre-classify message content once per messages update so renderMessage
  // (a FlatList renderItem) doesn't call classifyMessageContent on every
  // frame for every visible bubble. Mirror of ConversationScreen's items
  // useMemo which does the same classification.
  //
  // Vote messages are dropped from the visible list — they're already
  // rolled into the referenced poll's tally via pollAggregates below, so
  // showing them as bubbles would just duplicate the vote in the thread.
  const classifiedMessages = useMemo<ClassifiedMessage[]>(
    // Sanitise before classify so a tofu placeholder (#764) never reaches
    // the bubble's text branch. Vote messages are dropped from the visible
    // list — they're already rolled into the referenced poll's tally.
    () =>
      messages
        .map((m) => ({
          ...m,
          content: classifyMessageContent(sanitizeDisplayText(m.text)),
          // Derive the real NIP-17 kind (14 chat / 15 encrypted file) from the
          // stored text rather than hard-coding 14, so the info sheet reports
          // kind-15 for voice/image file bubbles. Precomputed here (not in the
          // hot renderMessage path) alongside the content classification.
          wireKind: deriveGroupWireKind(m.text),
        }))
        .filter((m) => m.content.kind !== 'pollVote'),
    [messages],
  );

  // Per-poll aggregates over the entire group history. Group messages carry a
  // real `senderPubkey` (unlike 1:1 where we synthesise a per-direction voter
  // id), so the tally gets accurate last-write-wins per member. Groups keep the
  // TEXT-encoded poll format (the group message store is text-only — no inner
  // wireKind/tags column), so structured NIP-88 is 1:1-only for now (#203);
  // legacy polls are adapted to the shared display/tally shape here.
  const pollAggregates = useMemo<Map<string, PollTally>>(() => {
    const polls: StoredPoll[] = [];
    const votes: VoteRecord[] = [];
    for (const m of messages) {
      const p = parsePoll(m.text);
      if (p) {
        polls.push(legacyPollToStored(m.id, p));
        continue;
      }
      const v = parseVote(m.text);
      if (v) {
        votes.push({
          pollId: v.pollId,
          voter: m.senderPubkey,
          optionIds: [String(v.optionId)],
          createdAt: m.createdAt,
        });
      }
    }
    const out = new Map<string, PollTally>();
    for (const poll of polls) out.set(poll.pollId, tallyPoll(poll, votes, myPubkey ?? null));
    return out;
  }, [messages, myPubkey]);

  // Poll attach handlers — the composer returns the validated question +
  // options; groups serialise them to the text body and hand off to sendText
  // (the same path the GIF / location / contact-share attachments use). Vote
  // sends use sendText too so the optimistic local-append behaviour matches.
  const handleSendPoll = useCallback(
    async (question: string, options: string[]): Promise<boolean> => {
      let body: string;
      try {
        body = buildPollMessage(question, options);
      } catch (err) {
        Alert.alert('Could not send poll', err instanceof Error ? err.message : 'Invalid poll.');
        return false;
      }
      return sendText(body);
    },
    [sendText],
  );

  const handleVotePoll = useCallback(
    async (pollId: string, optionId: string) => {
      const optNum = Number(optionId);
      const payload = buildVoteMessage(pollId, Number.isFinite(optNum) ? optNum : 0);
      const ok = await sendText(payload);
      if (!ok) {
        Alert.alert('Vote failed', 'Could not record your vote.');
      }
    },
    [sendText],
  );

  const trackedMessages = useMemo(
    () =>
      messages.map((m) => ({
        text: m.text,
        fromMe: m.senderPubkey === myPubkey,
        createdAt: m.createdAt,
      })),
    [messages, myPubkey],
  );
  const { isInvoicePaid } = usePaidInvoiceTracker(trackedMessages);

  const renderMessage = useCallback(
    ({ item }: { item: ClassifiedMessage }) => {
      const fromMe = item.senderPubkey === myPubkey;
      const senderName = fromMe
        ? null
        : (memberNameByPubkey.get(item.senderPubkey) ?? `${item.senderPubkey.slice(0, 8)}…`);
      // Reuse the shared bubble — same renderer 1:1 chats use, so contact /
      // invoice / location / image / GIF / poll cards all render identically
      // across chat types (#239). The classifier handles geo: + GIF + poll
      // detection up front; image / invoice / lnaddr / contact ride on the
      // text variant and detect at render time.
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
          pollAggregates={pollAggregates}
          onVotePoll={handleVotePoll}
          onToggleSecretMode={handleToggleSecretMode}
          isInvoicePaid={isInvoicePaid}
          // Group DMs are NIP-17 gift-wrapped: kind-14 chat or kind-15 encrypted
          // file (voice/image). The info sheet reads the protocol/kind off this,
          // so pass the per-message wireKind derived above rather than a hard
          // 14. Group sends aren't per-relay tracked, so no deliveryStatus (the
          // sheet shows "Not tracked").
          wireKind={item.wireKind}
          onShowInfo={handleShowInfo}
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
      pollAggregates,
      handleVotePoll,
      handleToggleSecretMode,
      isInvoicePaid,
      handleShowInfo,
    ],
  );

  if (!group) {
    return (
      <View style={styles.container}>
        <BrandGradientBackground />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.titleRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
              accessibilityLabel={t('groupConversationScreen.back')}
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
            <Text style={styles.title}>{t('groupConversationScreen.group')}</Text>
          </View>
        </View>
        <View style={styles.content}>
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t('groupConversationScreen.groupNotFound')}</Text>
            <Text style={styles.emptySubtitle}>{t('groupConversationScreen.groupDeleted')}</Text>
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
      t('groupConversationScreen.leaveGroupTitle'),
      t('groupConversationScreen.leaveGroupMessage', { name: group.name }),
      [
        { text: t('groupConversationScreen.cancel'), style: 'cancel' },
        {
          text: t('groupConversationScreen.leave'),
          style: 'destructive',
          onPress: async () => {
            await deleteGroup(group.id);
            navigation.goBack();
          },
        },
      ],
    );
  };

  return (
    // Outer wrapper used to be a KeyboardAvoidingView — that was a no-op
    // on Android (behavior=undefined) and let the composer slide behind
    // the IME (#250). The shared ConversationComposer (#251) now owns
    // the keyboard-handling via KeyboardStickyView, so the screen's own
    // wrapper is just a plain View that stacks header + content + composer.
    <View style={styles.container}>
      <BrandGradientBackground />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityLabel={t('groupConversationScreen.back')}
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
            accessibilityLabel={t('groupConversationScreen.renameGroup')}
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
            accessibilityLabel={t('groupConversationScreen.leaveGroupTitle')}
            testID="leave-group-button"
          >
            <LogOut size={18} color={colors.white} strokeWidth={2} />
          </TouchableOpacity>
        </View>
        {/* Tappable member-count line — opens GroupMembersSheet for
            add/remove. Replaces the inert text + horizontal chip strip
            that used to live below this header. See issue #259. */}
        <TouchableOpacity
          onPress={() => setMembersSheetVisible(true)}
          accessibilityLabel={t('groupConversationScreen.manageMembers')}
          testID="group-member-count"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.memberCount}>
            {members.length === 1
              ? t('groupConversationScreen.memberCountOne', { count: members.length })
              : t('groupConversationScreen.memberCountOther', { count: members.length })}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* See #470 — wrap the FlatList (NOT the composer) in an
            Animated.View whose marginBottom tracks the keyboard
            height so the IME doesn't hide the bottom messages. The
            composer below this wrapper handles its own keyboard
            avoidance via KeyboardStickyView. */}
        <Animated.View style={[{ flex: 1 }, animatedListLiftStyle]}>
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
                  <Text style={styles.emptySubtitle}>
                    {t('groupConversationScreen.noMessages')}
                  </Text>
                </View>
              }
            />
          )}
        </Animated.View>

        {/* Composer + attach panel + IME-aware safe area now live in the
            shared ConversationComposer (#251). Style overrides preserve
            the group-specific look (paper-plane Send button, transparent
            attach button, 12 dp horizontal padding). */}
        <ConversationComposer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          onStartVoiceNote={() => setVoiceSheetOpen(true)}
          sending={sending}
          onAttachToggle={() => (attachPanelOpen ? closeAttachPanel() : openAttachPanel())}
          attachOpen={attachPanelOpen}
          attachDisabled={sharingLocation || uploadingImage}
          attachLoading={sharingLocation || uploadingImage}
          onInputFocus={closeAttachPanel}
          placeholder={t('groupConversationScreen.typeMessage')}
          sendButtonVariant="paper-plane"
          composerPaddingHorizontal={12}
          accessibilityLabels={{
            input: t('groupConversationScreen.messageInput'),
            attach: t('groupConversationScreen.attach'),
            send: t('groupConversationScreen.sendMessage'),
          }}
          testIDs={{
            input: 'group-message-input',
            attach: 'group-attach-button',
            send: 'group-send-button',
          }}
          attachPanel={
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
              zapAccessibilityLabel={t('groupConversationScreen.zapUnavailable')}
              onSendInvoice={() => {
                closeAttachPanel();
                setInvoiceSheetOpen(true);
              }}
              onShareContact={() => {
                // Picker opens over the panel; close on cancel/select.
                setContactPickerOpen(true);
              }}
              onSharePoll={() => {
                // Composer opens over the panel — close it first so the
                // BottomSheet snaps without competing for touch focus
                // with the visible attach grid behind it.
                closeAttachPanel();
                setPollComposerOpen(true);
              }}
              onSendVoiceNote={() => setVoiceSheetOpen(true)}
            />
          }
        />
      </View>

      <VoiceRecordingSheet
        visible={voiceSheetOpen}
        onClose={() => setVoiceSheetOpen(false)}
        onSend={handleSendVoiceNote}
        sending={uploadingVoice}
      />

      <RenameGroupSheet
        visible={renameVisible}
        groupId={group.id}
        onClose={() => setRenameVisible(false)}
      />

      <GroupMembersSheet
        visible={membersSheetVisible}
        groupId={group.id}
        onClose={() => setMembersSheetVisible(false)}
        onMemberTap={(pk) => {
          // Close the manage-members sheet first so the preview sheet
          // doesn't stack on top of an open sheet — keeps the back-stack
          // predictable and matches the FriendPickerSheet handoff.
          const c = contacts.find((x) => x.pubkey === pk);
          setMembersSheetVisible(false);
          presentContactSheet({
            pubkey: pk,
            name: c?.profile?.displayName || c?.profile?.name || c?.petname || `${pk.slice(0, 8)}…`,
            picture: c?.profile?.picture ?? null,
            banner: c?.profile?.banner ?? null,
            nip05: c?.profile?.nip05 ?? null,
            lightningAddress: c?.profile?.lud16 ?? null,
            source: 'nostr',
          });
        }}
      />

      <GifPickerSheet
        visible={gifPickerOpen}
        onClose={() => setGifPickerOpen(false)}
        onSelect={handleSendGif}
      />

      <PollComposerSheet
        visible={pollComposerOpen}
        onClose={() => setPollComposerOpen(false)}
        onSend={handleSendPoll}
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
        title={t('groupConversationScreen.shareContactTitle', { name: group.name })}
        subtitle={t('groupConversationScreen.shareContactSubtitle')}
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

      <Modal
        visible={fullscreenGifUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreenGifUrl(null)}
      >
        <Pressable
          style={styles.fullscreenBackdrop}
          onPress={() => setFullscreenGifUrl(null)}
          accessibilityLabel={t('groupConversationScreen.closeFullscreenGif')}
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

      <ContactProfileSheet
        visible={profileSheetVisible}
        onClose={() => setProfileSheetVisible(false)}
        contact={sheetContact}
        onViewFullProfile={handleViewFullProfile}
        onMessage={
          sheetContact?.pubkey
            ? () => {
                const c = sheetContact;
                if (!c?.pubkey) return;
                setProfileSheetVisible(false);
                navigation.navigate('Conversation', {
                  pubkey: c.pubkey,
                  name: c.name,
                  picture: c.picture,
                  lightningAddress: c.lightningAddress,
                });
              }
            : undefined
        }
      />
      <SecretModeCelebration
        visible={secretCelebrationVisible}
        enabled={secretPendingEnabled}
        onDismiss={() => setSecretCelebrationVisible(false)}
      />
      <DeliveryDetailSheet
        info={messageSheetInfo}
        onClose={closeMessageInfo}
        onResend={canResendFromInfo ? handleResendFromInfo : undefined}
      />
    </View>
  );
};
export default GroupConversationScreen;
