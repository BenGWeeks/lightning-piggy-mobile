import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Modal,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  BackHandler,
  Linking,
  StyleSheet,
} from 'react-native';
import { Alert } from '../components/BrandedAlert';
import {
  KeyboardController,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { ArrowDown } from 'lucide-react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr, useNostrContacts, useNostrDmInbox } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import SendSheet from '../components/SendSheet';
import AttachPanel from '../components/AttachPanel';
import ConversationComposer from '../components/ConversationComposer';
import GifPickerSheet from '../components/GifPickerSheet';
import PollComposerSheet from '../components/PollComposerSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import VoiceRecordingSheet from '../components/VoiceRecordingSheet';
import ConversationMessageRow from '../components/ConversationMessageRow';
import NwcWalletShareSheet from '../components/NwcWalletShareSheet';
import MessageActionsSheet from '../components/MessageActionsSheet';
import SecretModeCelebration from '../components/SecretModeCelebration';
import { useGroups } from '../contexts/GroupsContext';
import TransactionDetailSheet, {
  TransactionDetailData,
} from '../components/TransactionDetailSheet';
import FriendPickerSheet from '../components/FriendPickerSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import { buildOsmViewUrl, SharedLocation } from '../services/locationService';
import { useLiveLocation } from '../contexts/LiveLocationContext';
import { useUserLocation } from '../contexts/UserLocationContext';
import LiveLocationDurationPicker from '../components/LiveLocationDurationPicker';
import { isConfigured as isGifConfigured } from '../services/giphyService';
import type { NostrProfile } from '../types/nostr';
import type { RootStackParamList } from '../navigation/types';
import { useNwcShareActions } from '../hooks/useNwcShareActions';
import { useSharedContactProfiles } from '../hooks/useSharedContactProfiles';
import { useConversationPolls } from '../hooks/useConversationPolls';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { usePaidInvoiceTracker } from '../hooks/usePaidInvoiceTracker';
import { useConversationComposerActions } from '../hooks/useConversationComposerActions';
import { useMessageInfoSheet } from '../hooks/useMessageInfoSheet';
import { useResolvedDmDeliveries } from '../hooks/useDmDeliveryStatuses';
import { useConversationLiveLocation } from '../hooks/useConversationLiveLocation';
import {
  type Item,
  type TimedItem,
  buildZapItems,
  buildConversationItems,
} from '../utils/conversationItems';
import { useConversationReactions } from '../hooks/useConversationReactions';
import { useConversationLoader } from '../hooks/useConversationLoader';
import DeliveryDetailSheet from '../components/DeliveryDetailSheet';
import { createConversationScreenStyles } from '../styles/ConversationScreen.styles';

type ConversationRoute = RouteProp<RootStackParamList, 'Conversation'>;
type ConversationNavigation = NativeStackNavigationProp<RootStackParamList, 'Conversation'>;

const ConversationScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createConversationScreenStyles(colors), [colors]);
  const navigation = useNavigation<ConversationNavigation>();
  const route = useRoute<ConversationRoute>();
  const insets = useSafeAreaInsets();
  // The composer owns its own keyboard wiring (KeyboardStickyView +
  // useReanimatedKeyboardAnimation) — see ConversationComposer.tsx.
  // ConversationScreen ALSO listens to the keyboard so the FlatList
  // shrinks by the keyboard height when the IME opens — without this
  // the bottom-most bubbles render under the keyboard because
  // KeyboardStickyView only translates the composer visually, it
  // doesn't reduce the FlatList's layout footprint (#470).
  const keyboard = useReanimatedKeyboardAnimation();
  const animatedListLiftStyle = useAnimatedStyle(() => ({
    // RNKC convention: keyboard.height.value is negative when the IME
    // is up, 0 when down. Negating it gives a positive marginBottom
    // equal to the keyboard height — pulls the FlatList's bottom edge
    // up flush with the (now-floating) composer's top.
    marginBottom: -keyboard.height.value,
  }));
  const { pubkey, name, picture, lightningAddress } = route.params;

  const {
    isLoggedIn,
    fetchConversation,
    sendDirectMessage,
    sendDirectRumor,
    appendLocalDmMessage,
    loadInitialConversation,
    persistDeliveryStatuses,
    signerType,
    pubkey: myPubkey,
    relays,
    profile,
    publishReaction,
    deleteReaction,
    fetchReactionsForMessages,
    fetchReactionDeletionsForReactions,
  } = useNostr();
  const { armLiveDmSub } = useNostrDmInbox();
  const { contacts } = useNostrContacts();
  // Cover the deep-link path (notification → straight to ConversationScreen
  // without passing the Messages tab). Idempotent — no-op if already armed.
  useEffect(() => {
    armLiveDmSub();
  }, [armLiveDmSub]);
  const { wallets, addNwcWallet } = useWallet();
  const { startShare, stopShare } = useLiveLocation();

  // Thread data lifecycle — read-through paint, background relay top-up,
  // abort-on-unmount, single-flight refresh (#868) — lives in this hook.
  const { messages, setMessages, loading, refreshing, handleRefresh } = useConversationLoader({
    pubkey,
    isLoggedIn,
    fetchConversation,
    loadInitialConversation,
    persistDeliveryStatuses,
  });
  const [draft, setDraft] = useState('');
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [detailTx, setDetailTx] = useState<TransactionDetailData | null>(null);
  // Profiles resolved from `nostr:` contact references the other party has
  // shared in this conversation — see useSharedContactProfiles. Keyed by hex
  // pubkey; a `null` value means the kind-0 lookup ran and came back empty.
  const sharedProfiles = useSharedContactProfiles(messages);
  const [attachPanelOpen, setAttachPanelOpen] = useState(false);
  // Secret Mode chat-trigger card overlay state — driven by
  // MessageBubble's "secretthreewords" magic message. Owned here so
  // the celebration confetti renders once over the conversation, not
  // per bubble cell.
  const { secretMode, setSecretMode } = useGroups();
  const [secretCelebrationVisible, setSecretCelebrationVisible] = useState(false);
  const [secretPendingEnabled, setSecretPendingEnabled] = useState(false);
  const handleToggleSecretMode = useCallback(() => {
    const next = !secretMode;
    setSecretMode(next);
    setSecretPendingEnabled(next);
    setSecretCelebrationVisible(true);
  }, [secretMode, setSecretMode]);
  // Memoised here (not inline at the JSX site) so the FlatList's
  // `contentContainerStyle` reference is stable across keystrokes —
  // every render of ConversationScreen would otherwise re-create the
  // array + inner object literal, forcing the FlatList to re-evaluate
  // its content container layout in a hot path.
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingTop: attachPanelOpen ? 16 : 8 }],
    [styles.listContent, attachPanelOpen],
  );

  // Inline attach panel sits ABOVE the text input inside the same
  // KeyboardStickyView. Opening dismisses the IME so we never have to
  // stack panel + composer + keyboard. Closing happens on input focus
  // (so the keyboard naturally takes back over) or hardware back.
  // No height guessing — the 4-col grid is intrinsic-sized.
  const openAttachPanel = useCallback(() => {
    setAttachPanelOpen(true);
    KeyboardController.dismiss();
  }, []);

  const closeAttachPanel = useCallback(() => {
    setAttachPanelOpen(false);
  }, []);

  // Android hardware-back: when the attach panel is open, swallow the
  // back press and close the panel instead of letting it bubble up to
  // the navigator (which would exit the conversation entirely).
  useEffect(() => {
    if (!attachPanelOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeAttachPanel();
      return true;
    });
    return () => sub.remove();
  }, [attachPanelOpen, closeAttachPanel]);
  const [invoiceSheetOpen, setInvoiceSheetOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [fullscreenGifUrl, setFullscreenGifUrl] = useState<string | null>(null);
  // Live-location chooser sheet (Snapshot vs Share live for…).
  const [liveLocationPickerOpen, setLiveLocationPickerOpen] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const listRef = useRef<FlatList<Item>>(null);

  const zapItems = useMemo<TimedItem[]>(() => buildZapItems(wallets, pubkey), [wallets, pubkey]);

  // Resolve each sent bubble's delivery tick from the eventId-keyed store (#857)
  // and re-render as statuses settle. Keyed by the stable rumor eventId, so the
  // local- → echo swap + the 10s re-fetch can't strip the tick. The hook
  // subscribes to the store, so `resolvedMessages` is a fresh array on every
  // settle — which is what flows the updated tick into `items` below.
  const resolvedMessages = useResolvedDmDeliveries(messages);
  const items = useMemo<Item[]>(
    () => buildConversationItems(resolvedMessages, zapItems),
    [resolvedMessages, zapItems],
  );

  // Poll aggregation + send/vote for this 1:1 thread (#203). Extracted to a
  // hook so the screen stays under the #703 size cap — see useConversationPolls.
  const { pollAggregates, handleSendPoll, handleVotePoll } = useConversationPolls({
    messages,
    myPubkey,
    pubkey,
    sendDirectMessage,
    sendDirectRumor,
    appendLocalDmMessage,
    setMessages,
  });

  // Jump to the newest message on first content load, and when the user is
  // already near the bottom and a new message arrives. The list is
  // `inverted`, so offset 0 is the visual bottom (data[0] = newest).
  // We track whether the user is "near the bottom" in a ref updated by
  // `onScroll` so a new message doesn't yank them back from an upward
  // scroll they did deliberately.
  const nearBottomRef = useRef(true);
  // `atBottom` drives the floating scroll-to-bottom button's visibility.
  // nearBottomRef alone is a ref so the FlatList onScroll handler can
  // update it without re-rendering; the mirror state re-renders on
  // actual transitions so the FAB fades in/out.
  const [atBottom, setAtBottom] = useState(true);
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (items.length === 0) {
      initialScrollDoneRef.current = false;
      return;
    }
    // Always perform the first scroll after items load, regardless of
    // current scroll position — this is the "open at newest" behaviour.
    const shouldScroll = !initialScrollDoneRef.current || nearBottomRef.current;
    if (!shouldScroll) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: initialScrollDoneRef.current });
      initialScrollDoneRef.current = true;
      // Programmatic scroll to the newest item — the FAB should match
      // that reality regardless of whether onScroll fires a final
      // event at offset 0 during the animation.
      nearBottomRef.current = true;
      setAtBottom(true);
    }, 50);
    return () => clearTimeout(t);
  }, [items.length]);

  const { isInvoicePaid } = usePaidInvoiceTracker(messages);

  // Contact preview sheet — peek a counterparty without leaving the
  // conversation. Tapping "View full profile" inside the sheet drills
  // into the ContactProfile route. Shared across header avatar tap,
  // shared-contact-card tap, and tx-detail counterparty tap.
  const [sheetContact, setSheetContact] = useState<ContactProfileBodyData | null>(null);
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  const presentContactSheet = useCallback((contact: ContactProfileBodyData) => {
    setSheetContact(contact);
    setProfileSheetVisible(true);
  }, []);
  const handleViewFullProfile = useCallback(() => {
    if (!sheetContact) return;
    setProfileSheetVisible(false);
    navigation.navigate('ContactProfile', { contact: sheetContact });
  }, [sheetContact, navigation]);

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

  // Append an optimistic local- message to BOTH React state (instant
  // paint) AND the per-conversation cache on disk (survives back-then-
  // reopen before the NIP-17 self-wrap echo arrives). The merge-side
  // dedup in mergeConversationMessages drops this local- row when the
  // real wrap echoes back from the relay.
  const {
    sending,
    uploadingImage,
    sharingLocation,
    uploadingVoice,
    appendOptimisticLocal,
    resendText,
    handleSend,
    handleShareLocation,
    handlePickAndSendImage,
    handleTakeAndSendPhoto,
    handleShareContactPicked,
    handleSendGif,
    handleSendVoiceNote,
    shareNwcWallet,
  } = useConversationComposerActions({
    pubkey,
    name,
    draft,
    setDraft,
    setMessages,
    setAttachPanelOpen,
    setContactPickerOpen,
    setGifPickerOpen,
    setVoiceSheetOpen,
  });

  // Tap a bubble → message-info sheet (#856), for sent + received. Logic lives
  // in useMessageInfoSheet to keep the screen under the size cap. Declared
  // after the composer hook because it needs its `resendText` for Re-publish.
  const {
    info: messageSheetInfo,
    showInfo: handleShowInfo,
    closeInfo: closeMessageInfo,
    resendFromInfo: handleResendFromInfo,
    canResend: canResendFromInfo,
  } = useMessageInfoSheet(resendText);

  // Live-location entry point (#206). The Attach → Location tile opens a
  // chooser sheet — snapshot or live for N — instead of going straight
  // into the snapshot flow. The snapshot path reuses the shared composer
  // hook's `handleShareLocation`; only the live path is screen-local
  // (it drives the LiveLocationProvider).
  const openLocationChooser = useCallback(() => {
    if (sharingLocation) return;
    setAttachPanelOpen(false);
    setLiveLocationPickerOpen(true);
  }, [sharingLocation]);

  const handleShareSnapshot = useCallback(async () => {
    setLiveLocationPickerOpen(false);
    await handleShareLocation();
  }, [handleShareLocation]);

  // Live-location: kick off a continuously-updating share. The provider
  // owns the watcher + ephemeral kind-20069 publishing; we just trigger
  // it and let the in-thread bubble (rendered via the start marker DM
  // that the provider sends as a side-effect) drive the visible state.
  const handleShareLive = useCallback(
    async (durationMs: number) => {
      setLiveLocationPickerOpen(false);
      const result = await startShare(pubkey, durationMs);
      if (!result.ok) {
        Alert.alert(t('conversationScreen.couldNotStartLiveShareTitle'), result.error);
        return;
      }
      // Append the exact published marker text so the optimistic bubble dedupes against the relay echo (mergeConversationMessages matches on identical text — a hand-built copy with a different startedAt would leave two "started" bubbles).
      appendOptimisticLocal(result.markerText);
    },
    [pubkey, startShare, appendOptimisticLocal, t],
  );

  const handleStopLive = useCallback(
    async (sessionId: string) => {
      const result = await stopShare(sessionId);
      if (!result.ok) {
        Alert.alert(t('conversationScreen.couldNotStopLiveShareTitle'), result.error);
      }
    },
    [stopShare, t],
  );

  const openLocation = useCallback(
    (loc: SharedLocation) => {
      const url = buildOsmViewUrl(loc);
      Linking.openURL(url).catch(() => {
        Alert.alert(
          t('conversationScreen.couldNotOpenLinkTitle'),
          t('conversationScreen.couldNotOpenLinkBody'),
        );
      });
    },
    [t],
  );

  // My live position for the location-card mini-maps (#206) — the blue
  // "me" dot + accuracy halo. Shared GPS subscription, retained for this
  // screen's lifetime (see UserLocationContext). Tapping a card's mini-map
  // opens the full-screen Map, mirroring the detail screens' affordance.
  const { pos: myPos } = useUserLocation();
  // `Map` lives in the Explore sub-stack, so target it through the
  // Explore tab rather than the root stack (the detail screens reach it
  // via a CompositeNavigationProp; ConversationScreen is root-stack only).
  const onOpenMap = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'MainTabs',
        params: {
          screen: 'Explore',
          params: {
            screen: 'Map',
            // Carry this DM's route so the Map's back button returns here
            // instead of dropping the user on the Explore tab.
            params: { returnTo: { screen: 'Conversation', params: route.params } },
          },
        },
      }),
    [navigation, route.params],
  );

  const handlePayInvoice = useCallback((raw: string) => {
    setInvoiceToPay(raw);
    setSendSheetOpen(true);
  }, []);

  // Share an NWC wallet (#431) — sender picker + recipient Add flows, both
  // gated behind an access warning. Extracted to keep this screen under the
  // size cap; the bearer connection string only ever moves inside the
  // encrypted NIP-17 DM.
  const {
    nwcWallets,
    nwcPickerOpen,
    openNwcSharePicker,
    closeNwcPicker,
    shareToWallet,
    addSharedWallet,
  } = useNwcShareActions({
    wallets,
    addNwcWallet,
    shareNwcWallet,
    peerName: name,
    onCloseAttachPanel: closeAttachPanel,
  });

  // Receive-side live-location plumbing (#206): the kind-20069 coordinate
  // subscription + per-session status/remaining read models the bubble
  // renders + a 1 Hz tick for the relative-time labels. Extracted to a hook
  // so this screen stays under the #703 size cap.
  const { liveLocationLatest, liveLocationBubbleStatus, liveLocationBubbleRemaining } =
    useConversationLiveLocation({ items, isLoggedIn, myPubkey, pubkey, signerType, relays });

  // Per-message reactions + long-press action state (#205) — kind-7 fetch /
  // reduce, optimistic publish/retract toggle, and the actioned-message
  // descriptor — live in a hook so this screen stays composition.
  const {
    reactionsByTarget,
    actionsForMessage,
    closeMessageActions,
    handleToggleReaction,
    handleZapMessage,
    reactionsForItem,
    buildOnLongPress,
    buildOnToggleReaction,
  } = useConversationReactions({
    messages,
    myPubkey,
    peerPubkey: pubkey,
    fetchReactionsForMessages,
    publishReaction,
    deleteReaction,
    fetchReactionDeletions: fetchReactionDeletionsForReactions,
    onZapMessage: () => setSendSheetOpen(true),
  });

  const renderItem = useCallback(
    ({ item }: { item: Item }) => (
      <ConversationMessageRow
        item={item}
        styles={styles}
        colors={colors}
        sharedProfiles={sharedProfiles}
        isInvoicePaid={isInvoicePaid}
        onPayInvoice={handlePayInvoice}
        onOpenContact={openSharedContact}
        onOpenLocation={openLocation}
        onOpenGifFullscreen={setFullscreenGifUrl}
        onToggleSecretMode={handleToggleSecretMode}
        pollAggregates={pollAggregates}
        onVotePoll={handleVotePoll}
        onShowTxDetail={setDetailTx}
        liveLocationLatest={liveLocationLatest}
        liveLocationStatus={liveLocationBubbleStatus}
        liveLocationRemainingMs={liveLocationBubbleRemaining}
        onStopLiveLocation={handleStopLive}
        myLat={myPos?.lat ?? null}
        myLon={myPos?.lon ?? null}
        myAccuracyMetres={myPos?.accuracy ?? null}
        myAvatarUri={profile?.picture ?? null}
        peerAvatarUri={picture ?? null}
        onOpenMap={onOpenMap}
        onShowInfo={handleShowInfo}
        onLongPress={buildOnLongPress(item)}
        reactions={reactionsForItem(item)}
        onToggleReaction={buildOnToggleReaction(item)}
        onAddNwc={addSharedWallet}
      />
    ),
    [
      openLocation,
      isInvoicePaid,
      sharedProfiles,
      openSharedContact,
      handlePayInvoice,
      addSharedWallet,
      pollAggregates,
      handleVotePoll,
      handleToggleSecretMode,
      handleShowInfo,
      liveLocationLatest,
      liveLocationBubbleStatus,
      liveLocationBubbleRemaining,
      handleStopLive,
      myPos,
      picture,
      profile,
      onOpenMap,
      styles,
      colors,
      reactionsForItem,
      buildOnLongPress,
      buildOnToggleReaction,
    ],
  );

  const avatarNode =
    picture && !avatarError && isSupportedImageUrl(picture) ? (
      <ExpoImage
        source={{ uri: picture }}
        style={styles.headerAvatar}
        cachePolicy="memory-disk"
        recyclingKey={picture}
        autoplay={false}
        onError={() => setAvatarError(true)}
      />
    ) : (
      <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
          <Path
            d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
            stroke={colors.textSupplementary}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      </View>
    );

  return (
    <View style={styles.container}>
      {/* Paint the safe-area / status-bar strip pink so the white
          system icons (time, signal, battery) stay visible against
          the brand colour instead of disappearing into our near-white
          app background. */}
      <View style={{ height: insets.top, backgroundColor: colors.brandPink }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityLabel={t('conversationScreen.goBack')}
          testID="conversation-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 18l-6-6 6-6"
              stroke={colors.textHeader}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerPeer}
          onPress={() => {
            const known = contacts.find((c) => c.pubkey === pubkey)?.profile ?? null;
            presentContactSheet({
              pubkey,
              name,
              picture: known?.picture ?? picture ?? null,
              banner: known?.banner ?? null,
              nip05: known?.nip05 ?? null,
              lightningAddress: known?.lud16 ?? lightningAddress ?? null,
              source: 'nostr',
            });
          }}
          accessibilityLabel={t('conversationScreen.openProfile', { name })}
          testID="chat-header-open-profile"
        >
          {avatarNode}
          <Text style={styles.headerName} numberOfLines={1}>
            {name}
          </Text>
        </TouchableOpacity>
      </View>

      {/* KeyboardStickyView (below) floats the composer above the IME
          on Android 15+ edge-to-edge. `react-native-edge-to-edge` (in
          app.config.ts) installs the `WindowInsetsCompat` root listener
          that makes the IME inset visible to RNKC in the first place —
          without it every keyboard API silently reported 0 height on
          Android 16 (#194 diagnosis). `offset.opened: -insets.bottom`
          pulls the composer flush against the keyboard's top edge
          (RNKC's canonical chat pattern). */}
      <View style={styles.flex}>
        {/* Wrapping the list (and scroll-to-bottom FAB) in an
            Animated.View whose marginBottom tracks the keyboard
            height — shrinks the list's layout footprint so the
            bottom-most bubbles aren't hidden under the IME. The
            composer below this wrapper sits OUTSIDE the lifted
            block; KeyboardStickyView handles the composer's own
            keyboard avoidance independently. */}
        <Animated.View style={[styles.flex, animatedListLiftStyle]}>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.brandPink} />
              <Text style={styles.loadingText}>{t('conversationScreen.loadingMessages')}</Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              style={styles.flex}
              data={items}
              keyExtractor={(it) => it.id}
              renderItem={renderItem}
              contentContainerStyle={listContentStyle}
              inverted
              // Window the list so a thread with hundreds of messages
              // doesn't mount every row up front — first-frame work goes
              // from "render all N bubbles + avatars" to "render the
              // 20 newest then lazy-mount as the user scrolls". These
              // defaults are chosen for chat-style threads: one screen
              // fits ~8-10 bubbles, so 20 covers the visible viewport
              // plus one screen of pre-roll for smooth momentum scrolls.
              //
              // NOTE: `removeClippedSubviews` is deliberately OFF. It's
              // broken with `inverted` on Android — breaks the contentOffset
              // reporting so onScroll's `y < 200` check flips when the user
              // is visually at the bottom, making the scroll-to-bottom FAB
              // show spuriously. See facebook/react-native#30521 / #26061.
              initialNumToRender={20}
              maxToRenderPerBatch={10}
              windowSize={10}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>{t('conversationScreen.noMessages')}</Text>
                  <Text style={styles.emptySubtitle}>
                    {lightningAddress
                      ? t('conversationScreen.sayHiZap')
                      : t('conversationScreen.sayHi')}
                  </Text>
                </View>
              }
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
              onScroll={(e) => {
                const y = e.nativeEvent.contentOffset.y;
                // "Near bottom" in an inverted list = scroll offset ~0.
                // 200 px of slack covers the contentContainer padding +
                // one message bubble, so sitting at the newest message
                // reliably registers as "at bottom" for both the
                // auto-scroll-on-new-message behaviour and the FAB.
                const isNear = y < 200;
                nearBottomRef.current = isNear;
                // Mirror to state only when the boolean actually flips —
                // this keeps onScroll cheap while still triggering a
                // re-render for the FAB's appearance.
                setAtBottom((prev) => (prev !== isNear ? isNear : prev));
              }}
              scrollEventThrottle={100}
            />
          )}

          {/* Backdrop tap-to-close: when the attach panel is open, an
            absolute transparent Pressable sits above the FlatList area.
            Tapping anywhere on the messages closes the panel (matches
            WhatsApp behaviour). Trade-off: you can't tap a message bubble
            while the panel is open — close the panel first. */}
          {attachPanelOpen ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeAttachPanel}
              accessibilityLabel={t('conversationScreen.closeAttachPanel')}
              testID="conversation-attach-backdrop"
            />
          ) : null}

          {!atBottom && !loading ? (
            <View style={styles.scrollToBottomWrap} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.scrollToBottomFab}
                onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
                accessibilityLabel={t('conversationScreen.scrollToRecent')}
                testID="conversation-scroll-to-bottom"
              >
                <ArrowDown size={20} color={colors.white} />
              </TouchableOpacity>
            </View>
          ) : null}
        </Animated.View>

        {/* Composer + attach panel + IME-aware safe area now live in the
            shared ConversationComposer (#251). Both the 1:1 and group
            screens render through the same component so the keyboard
            wrapper, animated paddingBottom, and attach-panel placement
            can't drift again the way they did between v22 and v26. */}
        <ConversationComposer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          onStartVoiceNote={() => setVoiceSheetOpen(true)}
          sending={sending}
          disabled={!isLoggedIn}
          onAttachToggle={() => (attachPanelOpen ? closeAttachPanel() : openAttachPanel())}
          attachOpen={attachPanelOpen}
          attachDisabled={sharingLocation || uploadingImage}
          attachLoading={sharingLocation || uploadingImage}
          onInputFocus={closeAttachPanel}
          placeholder={t('conversationScreen.messagePlaceholder')}
          // 1:1 ships the compact lucide Send icon (40x40) + a light-grey
          // attach button background. Defaults match this so we keep the
          // shipped 1:1 visuals byte-for-byte.
          sendButtonVariant="icon"
          attachButtonHasBackground
          composerPaddingHorizontal={10}
          testIDs={{
            input: 'conversation-input',
            attach: 'conversation-attach',
            send: 'conversation-send',
          }}
          attachPanel={
            <AttachPanel
              onShareLocation={openLocationChooser}
              onSendImage={handlePickAndSendImage}
              onTakePhoto={handleTakeAndSendPhoto}
              onSendZap={() => {
                closeAttachPanel();
                setSendSheetOpen(true);
              }}
              zapDisabled={!lightningAddress}
              zapAccessibilityLabel={t('conversationScreen.zapUnavailable')}
              onSendInvoice={() => {
                closeAttachPanel();
                setInvoiceSheetOpen(true);
              }}
              onShareContact={() => {
                // Picker opens over the conversation; don't close the
                // panel until the user actually picks (or cancels).
                setContactPickerOpen(true);
              }}
              onShareWallet={openNwcSharePicker}
              onSendGif={
                isGifConfigured()
                  ? () => {
                      // GifPickerSheet opens over the panel.
                      setGifPickerOpen(true);
                    }
                  : undefined
              }
              onSharePoll={() => {
                // Composer opens over the AttachPanel — close the panel
                // first so the BottomSheet snaps without competing for
                // touch focus with the visible attach grid behind it.
                closeAttachPanel();
                setPollComposerOpen(true);
              }}
              onSendVoiceNote={() => {
                // VoiceRecordingSheet opens over the panel; leave the panel
                // mounted so dismissing the sheet returns the user to it.
                setVoiceSheetOpen(true);
              }}
            />
          }
        />
      </View>
      <LiveLocationDurationPicker
        visible={liveLocationPickerOpen}
        onClose={() => setLiveLocationPickerOpen(false)}
        onChooseSnapshot={handleShareSnapshot}
        onChooseLive={handleShareLive}
      />
      <VoiceRecordingSheet
        visible={voiceSheetOpen}
        onClose={() => setVoiceSheetOpen(false)}
        onSend={handleSendVoiceNote}
        sending={uploadingVoice}
      />
      <GifPickerSheet
        visible={gifPickerOpen}
        onClose={() => {
          setGifPickerOpen(false);
          setAttachPanelOpen(false);
        }}
        onSelect={handleSendGif}
      />
      <PollComposerSheet
        visible={pollComposerOpen}
        onClose={() => setPollComposerOpen(false)}
        onSend={handleSendPoll}
      />
      <Modal
        visible={fullscreenGifUrl !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={() => setFullscreenGifUrl(null)}
      >
        <Pressable
          style={styles.fullscreenBackdrop}
          onPress={() => setFullscreenGifUrl(null)}
          accessibilityLabel={t('conversationScreen.closeFullscreenGif')}
          testID="conversation-gif-fullscreen"
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
      <FriendPickerSheet
        visible={contactPickerOpen}
        onClose={() => {
          // Closing the picker with no selection also closes the
          // AttachPanel underneath — the user has navigated away from
          // the attach flow, the parent is no longer relevant.
          setContactPickerOpen(false);
          setAttachPanelOpen(false);
        }}
        onSelect={handleShareContactPicked}
        title={t('conversationScreen.shareContactTitle', { name })}
        subtitle={t('conversationScreen.shareContactSubtitle')}
      />
      <NwcWalletShareSheet
        visible={nwcPickerOpen}
        onClose={closeNwcPicker}
        wallets={nwcWallets}
        onSelect={shareToWallet}
      />
      <ReceiveSheet
        visible={invoiceSheetOpen}
        onClose={() => setInvoiceSheetOpen(false)}
        presetFriend={{
          pubkey,
          name,
          picture: picture ?? null,
          lightningAddress: lightningAddress ?? null,
        }}
        onSent={(payload) => {
          appendOptimisticLocal(payload);
        }}
      />
      <SendSheet
        visible={sendSheetOpen}
        onClose={() => {
          setSendSheetOpen(false);
          setInvoiceToPay(null);
          handleRefresh();
        }}
        initialAddress={invoiceToPay ?? lightningAddress ?? undefined}
        // Paying a bolt11 invoice encodes the recipient in the invoice
        // itself, so clear the per-conversation recipient hints. Paying a
        // lightning address (contains `@`, not `ln…`) keeps the hints so
        // SendSheet's label reads `Pay to <name>`.
        initialPicture={
          invoiceToPay && !invoiceToPay.includes('@') ? undefined : (picture ?? undefined)
        }
        recipientPubkey={invoiceToPay && !invoiceToPay.includes('@') ? undefined : pubkey}
        recipientName={invoiceToPay && !invoiceToPay.includes('@') ? undefined : name}
      />
      <TransactionDetailSheet
        visible={detailTx !== null}
        tx={detailTx}
        onClose={() => setDetailTx(null)}
        onCounterpartyPress={(contact) => {
          setDetailTx(null);
          presentContactSheet(contact);
        }}
      />
      <MessageActionsSheet
        visible={actionsForMessage !== null}
        onClose={closeMessageActions}
        myReactions={
          actionsForMessage
            ? (reactionsByTarget.get(actionsForMessage.targetId)?.myReactions ?? {})
            : {}
        }
        onToggleReaction={handleToggleReaction}
        // Zap is only meaningful for an incoming bubble whose author has a
        // lightning route. Hidden for our own outgoing bubbles (zapping
        // yourself is a no-op) and when the peer has no lud16.
        onZap={
          actionsForMessage && !actionsForMessage.fromMe && lightningAddress
            ? handleZapMessage
            : undefined
        }
      />
      <ContactProfileSheet
        visible={profileSheetVisible}
        onClose={() => setProfileSheetVisible(false)}
        contact={sheetContact}
        onViewFullProfile={handleViewFullProfile}
        onMessage={
          sheetContact?.pubkey && sheetContact.pubkey !== pubkey
            ? () => {
                const c = sheetContact;
                if (!c?.pubkey) return;
                setProfileSheetVisible(false);
                navigation.replace('Conversation', {
                  pubkey: c.pubkey,
                  name: c.name,
                  picture: c.picture,
                  lightningAddress: c.lightningAddress,
                });
              }
            : undefined
        }
        onZap={
          sheetContact?.lightningAddress
            ? () => {
                setProfileSheetVisible(false);
                setSendSheetOpen(true);
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

export default ConversationScreen;
