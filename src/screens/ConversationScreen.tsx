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
import { useNostr, subscribeDmMessages } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import SendSheet from '../components/SendSheet';
import AttachPanel from '../components/AttachPanel';
import ConversationComposer from '../components/ConversationComposer';
import GifPickerSheet from '../components/GifPickerSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import VoiceRecordingSheet from '../components/VoiceRecordingSheet';
import ConversationMessageRow from '../components/ConversationMessageRow';
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
import { fetchProfile, DEFAULT_RELAYS } from '../services/nostrService';
import { isConfigured as isGifConfigured } from '../services/giphyService';
import type { NostrProfile } from '../types/nostr';
import type { RootStackParamList } from '../navigation/types';
import { extractSharedContact } from '../utils/messageContent';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { usePaidInvoiceTracker } from '../hooks/usePaidInvoiceTracker';
import { useConversationComposerActions } from '../hooks/useConversationComposerActions';
import { useConversationLiveLocation } from '../hooks/useConversationLiveLocation';
import {
  type Item,
  type TimedItem,
  buildZapItems,
  buildConversationItems,
} from '../utils/conversationItems';
import { createConversationScreenStyles } from '../styles/ConversationScreen.styles';

type ConversationRoute = RouteProp<RootStackParamList, 'Conversation'>;
type ConversationNavigation = NativeStackNavigationProp<RootStackParamList, 'Conversation'>;

const ConversationScreen: React.FC = () => {
  const colors = useThemeColors();
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
    getCachedConversation,
    signerType,
    pubkey: myPubkey,
    contacts,
    relays,
    profile,
    armLiveDmSub,
  } = useNostr();
  // Cover the deep-link path (notification → straight to ConversationScreen
  // without passing the Messages tab). Idempotent — no-op if already armed.
  useEffect(() => {
    armLiveDmSub();
  }, [armLiveDmSub]);
  const { wallets } = useWallet();
  const { startShare, stopShare } = useLiveLocation();

  const [messages, setMessages] = useState<
    { id: string; fromMe: boolean; text: string; createdAt: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [detailTx, setDetailTx] = useState<TransactionDetailData | null>(null);
  // Profiles resolved from `nostr:` contact references the other party
  // has shared in this conversation. Keyed by hex pubkey; a `null` value
  // means we tried and the kind-0 lookup came back empty.
  const [sharedProfiles, setSharedProfiles] = useState<Record<string, NostrProfile | null>>({});
  // Tracks which pubkeys have already been scheduled for a kind-0 fetch
  // so the batch-fetch effect deps can be [messages] only, without needing
  // sharedProfiles in the array (which would cause an extra cycle after
  // every fetch batch writes the state).
  const scheduledProfilePubkeys = useRef(new Set<string>());
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
  const [fullscreenGifUrl, setFullscreenGifUrl] = useState<string | null>(null);
  // Live-location chooser sheet (Snapshot vs Share live for…).
  const [liveLocationPickerOpen, setLiveLocationPickerOpen] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const listRef = useRef<FlatList<Item>>(null);

  const zapItems = useMemo<TimedItem[]>(() => buildZapItems(wallets, pubkey), [wallets, pubkey]);

  const items = useMemo<Item[]>(
    () => buildConversationItems(messages, zapItems),
    [messages, zapItems],
  );

  // Mount/unmount tracker so the async `load()` below can bail when
  // the user navigates back mid-fetch. Without this, every back-press
  // during the 6-12 s cold fetchConversation still runs the full
  // decrypt + persist chain on the unmounted component, wasting JS
  // thread time that could have been responding to input.
  // Declared BEFORE `load` because `load`'s body closes over it.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (!isLoggedIn) {
        setLoading(false);
        return;
      }
      // Paint cached messages instantly if we have any — user sees a
      // populated thread within one frame instead of "Loading…" for
      // the 6-8 s relay round-trip. Arcade `db_only=true` pattern.
      // Only show the spinner if the cache was empty (true cold open).
      const cached = await getCachedConversation(pubkey);
      if (isMountedRef.current && cached.length > 0) {
        setMessages(cached);
        setLoading(false);
      } else if (isMountedRef.current && showSpinner) {
        setLoading(true);
      }
      try {
        const conv = await fetchConversation(pubkey);
        // If the user navigated away while the fetch was in flight,
        // don't fire state updates — those would either trigger a
        // re-render on an unmounted component (React warning) or land
        // on the *next* thread that inherits this instance. Check the
        // ref and bail.
        if (isMountedRef.current) {
          setMessages(conv);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [isLoggedIn, fetchConversation, getCachedConversation, pubkey],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Live updates: NostrContext fires `subscribeDmMessages` after a
  // kind-1059 wrap arrives via the long-lived relay sub and decrypts
  // to a 1:1 rumor for this thread's peer (#349). Re-fetching the
  // conversation is cheap because the new wrap is now in the
  // persistent NIP-17 cache, so fetchConversation short-circuits the
  // relay round-trip and the thread re-renders within one tick.
  useEffect(() => {
    if (!pubkey) return;
    const target = pubkey.toLowerCase();
    const unsubscribe = subscribeDmMessages((partnerPubkey) => {
      if (partnerPubkey !== target) return;
      load(false);
    });
    return unsubscribe;
  }, [pubkey, load]);

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

  // Batch-fetch profiles for every `nostr:` profile reference that appears
  // in the conversation. Relay hints from the nprofile (when present) are
  // merged with the default set so we find the shared person's kind-0
  // even if they publish on niche relays.
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(false);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

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
    handleSend,
    handleShareLocation,
    handlePickAndSendImage,
    handleTakeAndSendPhoto,
    handleShareContactPicked,
    handleSendGif,
    handleSendVoiceNote,
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
        Alert.alert('Could not start live share', result.error);
        return;
      }
      // Append the exact published marker text so the optimistic bubble dedupes against the relay echo (mergeConversationMessages matches on identical text — a hand-built copy with a different startedAt would leave two "started" bubbles).
      appendOptimisticLocal(result.markerText);
    },
    [pubkey, startShare, appendOptimisticLocal],
  );

  const handleStopLive = useCallback(
    async (sessionId: string) => {
      const result = await stopShare(sessionId);
      if (!result.ok) {
        Alert.alert('Could not stop live share', result.error);
      }
    },
    [stopShare],
  );

  const openLocation = useCallback((loc: SharedLocation) => {
    const url = buildOsmViewUrl(loc);
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', 'No browser is available to open OpenStreetMap.');
    });
  }, []);

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
        params: { screen: 'Explore', params: { screen: 'Map' } },
      }),
    [navigation],
  );

  const handlePayInvoice = useCallback((raw: string) => {
    setInvoiceToPay(raw);
    setSendSheetOpen(true);
  }, []);

  // Receive-side live-location plumbing (#206): the kind-20069 coordinate
  // subscription + per-session status/remaining read models the bubble
  // renders + a 1 Hz tick for the relative-time labels. Extracted to a hook
  // so this screen stays under the #703 size cap.
  const { liveLocationLatest, liveLocationBubbleStatus, liveLocationBubbleRemaining } =
    useConversationLiveLocation({ items, isLoggedIn, myPubkey, pubkey, signerType, relays });

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
      />
    ),
    [
      openLocation,
      isInvoicePaid,
      sharedProfiles,
      openSharedContact,
      handlePayInvoice,
      handleToggleSecretMode,
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
          accessibilityLabel="Go back"
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
          accessibilityLabel={`Open ${name}'s profile`}
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
              <Text style={styles.loadingText}>Loading messages…</Text>
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
                  <Text style={styles.emptyTitle}>No messages yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Say hi{lightningAddress ? ' — or send a zap.' : '.'}
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
              accessibilityLabel="Close attachment panel"
              testID="conversation-attach-backdrop"
            />
          ) : null}

          {!atBottom && !loading ? (
            <View style={styles.scrollToBottomWrap} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.scrollToBottomFab}
                onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
                accessibilityLabel="Scroll to most recent message"
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
          placeholder="Message"
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
              zapAccessibilityLabel="Send a zap (unavailable — peer has no Lightning Address)"
              onSendInvoice={() => {
                closeAttachPanel();
                setInvoiceSheetOpen(true);
              }}
              onShareContact={() => {
                // Picker opens over the conversation; don't close the
                // panel until the user actually picks (or cancels).
                setContactPickerOpen(true);
              }}
              onSendGif={
                isGifConfigured()
                  ? () => {
                      // GifPickerSheet opens over the panel.
                      setGifPickerOpen(true);
                    }
                  : undefined
              }
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
        title={`Share a contact with ${name}`}
        subtitle="They'll see it as a Nostr profile card they can open."
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
    </View>
  );
};

export default ConversationScreen;
