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
  AppState,
  BackHandler,
  Image,
  Linking,
  StyleSheet,
} from 'react-native';
import { Alert } from '../components/BrandedAlert';
import { KeyboardController } from 'react-native-keyboard-controller';
import Svg, { Circle, Path } from 'react-native-svg';
import { Zap, ArrowDown } from 'lucide-react-native';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import * as nwcService from '../services/nwcService';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';
import SendSheet from '../components/SendSheet';
import AttachPanel from '../components/AttachPanel';
import ConversationComposer from '../components/ConversationComposer';
import GifPickerSheet from '../components/GifPickerSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import MessageBubble from '../components/MessageBubble';
import TransactionDetailSheet, {
  TransactionDetailData,
  CounterpartyContact,
} from '../components/TransactionDetailSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import FriendPickerSheet, { PickedFriend } from '../components/FriendPickerSheet';
import {
  getCurrentLocation,
  formatGeoMessage,
  buildOsmViewUrl,
  formatCoordsForDisplay,
  SharedLocation,
} from '../services/locationService';
import {
  fetchProfile,
  nprofileEncode,
  buildProfileRelayHints,
  DEFAULT_RELAYS,
} from '../services/nostrService';
import { isConfigured as isGifConfigured, Gif } from '../services/giphyService';
import type { NostrProfile } from '../types/nostr';
import type { RootStackParamList } from '../navigation/types';
import {
  classifyMessageContent,
  extractInvoice,
  extractSharedContact,
  formatTime,
} from '../utils/messageContent';
import {
  deliveryStatusFromPublishResult,
  nextDeliveryStatus,
  type MessageDeliveryStatus,
} from '../utils/messageDeliveryStatus';

type ConversationRoute = RouteProp<RootStackParamList, 'Conversation'>;
type ConversationNavigation = NativeStackNavigationProp<RootStackParamList, 'Conversation'>;

type Item =
  | {
      kind: 'message';
      id: string;
      fromMe: boolean;
      text: string;
      createdAt: number;
      deliveryStatus?: MessageDeliveryStatus;
    }
  | {
      kind: 'zap';
      id: string;
      fromMe: boolean;
      amountSats: number;
      comment: string;
      createdAt: number;
      tx: TransactionDetailData;
    }
  | {
      kind: 'location';
      id: string;
      fromMe: boolean;
      location: SharedLocation;
      createdAt: number;
      deliveryStatus?: MessageDeliveryStatus;
    }
  | {
      kind: 'gif';
      id: string;
      fromMe: boolean;
      url: string;
      createdAt: number;
      deliveryStatus?: MessageDeliveryStatus;
    }
  | {
      kind: 'dayHeader';
      id: string;
      label: string;
    };

// Every Item variant except the dayHeader synthetic row — these are the
// ones that have a real `createdAt` and participate in chronological sort.
type TimedItem = Exclude<Item, { kind: 'dayHeader' }>;

// Local-only formatter — only used for the dayHeader rule between
// chronological message groups, so it stays here rather than in the
// shared `messageContent` util (which sticks to bubble-level concerns).
function formatDayHeader(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const ConversationScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<ConversationNavigation>();
  const route = useRoute<ConversationRoute>();
  const insets = useSafeAreaInsets();
  // The composer owns its own keyboard wiring (KeyboardStickyView +
  // useReanimatedKeyboardAnimation) — see ConversationComposer.tsx.
  const { pubkey, name, picture, lightningAddress } = route.params;

  const {
    isLoggedIn,
    fetchConversation,
    getCachedConversation,
    sendDirectMessage,
    signEvent,
    contacts,
    relays,
  } = useNostr();
  const { wallets, activeWalletId, activeWallet } = useWallet();

  const [messages, setMessages] = useState<
    {
      id: string;
      fromMe: boolean;
      text: string;
      createdAt: number;
      // Only populated for messages that this app instance just sent;
      // historical messages loaded from the relay cache leave it
      // undefined and the bubble suppresses the tick row entirely.
      deliveryStatus?: MessageDeliveryStatus;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [detailTx, setDetailTx] = useState<TransactionDetailData | null>(null);
  const [profileContact, setProfileContact] = useState<CounterpartyContact | null>(null);
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
  const [sharingLocation, setSharingLocation] = useState(false);
  // Payment hashes of outgoing invoices the active NWC wallet reports paid.
  const [paidHashes, setPaidHashes] = useState<Set<string>>(() => new Set());
  const listRef = useRef<FlatList<Item>>(null);

  const zapItems = useMemo<TimedItem[]>(() => {
    const out: TimedItem[] = [];
    for (const w of wallets) {
      for (const tx of w.transactions) {
        const cp = tx.zapCounterparty;
        if (!cp || !cp.pubkey || cp.pubkey !== pubkey) continue;
        const when = tx.settled_at ?? tx.created_at;
        if (!when) continue;
        out.push({
          kind: 'zap',
          id: `zap-${tx.paymentHash ?? tx.bolt11 ?? when}-${tx.type}`,
          fromMe: tx.type === 'outgoing',
          amountSats: Math.abs(tx.amount),
          comment: cp.comment ?? '',
          createdAt: when,
          tx,
        });
      }
    }
    return out;
  }, [wallets, pubkey]);

  const items = useMemo<Item[]>(() => {
    const msgItems: TimedItem[] = messages.map((m) => {
      // Classify each raw DM into the variant the renderer expects. Same
      // shape used by the group screen (via `classifyMessageContent`)
      // — keeps gif / geo detection in one place.
      const classified = classifyMessageContent(m.text);
      if (classified.kind === 'gif') {
        return {
          kind: 'gif',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          url: classified.url,
          createdAt: m.createdAt,
          deliveryStatus: m.deliveryStatus,
        };
      }
      if (classified.kind === 'location') {
        return {
          kind: 'location',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          location: classified.location,
          createdAt: m.createdAt,
          deliveryStatus: m.deliveryStatus,
        };
      }
      return {
        kind: 'message',
        id: `dm-${m.id}`,
        fromMe: m.fromMe,
        text: m.text,
        createdAt: m.createdAt,
        deliveryStatus: m.deliveryStatus,
      };
    });
    // Descending order — index 0 is newest. The FlatList is `inverted`, so
    // index 0 renders at the visual bottom (chat default) and the
    // RefreshControl attaches to the visual bottom too, which is what
    // drives the pull-up-to-refresh gesture.
    const sorted = [...msgItems, ...zapItems].sort((a, b) => b.createdAt - a.createdAt);

    // Interleave "Today / Yesterday / <date>" dividers between day groups.
    // With an inverted FlatList the array runs newest → oldest, so each
    // divider must sit AFTER its group's oldest entry in array order
    // (= visually above the group's newest entry). This gives the same
    // chat-standard look as Transactions' date headers.
    if (sorted.length === 0) return sorted;
    const withHeaders: Item[] = [];
    const dayKey = (ts: number) => new Date(ts * 1000).toDateString();
    let prevKey: string | null = null;
    let prevTs: number | null = null;
    for (const it of sorted) {
      const key = dayKey(it.createdAt);
      if (prevKey !== null && prevKey !== key && prevTs !== null) {
        withHeaders.push({
          kind: 'dayHeader',
          id: `day-${prevKey}`,
          label: formatDayHeader(prevTs),
        });
      }
      withHeaders.push(it);
      prevKey = key;
      prevTs = it.createdAt;
    }
    if (prevKey !== null && prevTs !== null) {
      withHeaders.push({
        kind: 'dayHeader',
        id: `day-${prevKey}`,
        label: formatDayHeader(prevTs),
      });
    }
    return withHeaders;
  }, [messages, zapItems]);

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

  // Payment hashes of outgoing invoices that are plausibly still payable —
  // not expired, not already known paid, and (as a belt-and-braces cap)
  // Payment hashes known paid from our wallet's own transaction history,
  // split by direction so we don't mis-flag an invoice paid just because
  // its payment_hash happens to appear on the wrong side of the ledger
  // (e.g. a self-payment or a routed tx reusing the same hash).
  //   - Outgoing invoice we sent, counterparty paid → match an *incoming*
  //     wallet tx carrying the same payment_hash.
  //   - Incoming invoice we received, we paid → match an *outgoing* wallet
  //     tx carrying the same payment_hash.
  // Wallet-tx sync keeps these fresh for free; no per-invoice NWC poll
  // needed for either direction.
  const { paidOutgoingHashes, paidIncomingHashes } = useMemo(() => {
    const out = new Set<string>();
    const inc = new Set<string>();
    for (const w of wallets) {
      for (const tx of w.transactions) {
        if (!tx.paymentHash) continue;
        if (tx.type === 'incoming') out.add(tx.paymentHash);
        else if (tx.type === 'outgoing') inc.add(tx.paymentHash);
      }
    }
    return { paidOutgoingHashes: out, paidIncomingHashes: inc };
  }, [wallets]);

  // Helper used in the render path — picks the appropriate set based on the
  // invoice's direction, layered with the NWC-polled outgoing results.
  const isInvoicePaid = useCallback(
    (paymentHash: string, fromMe: boolean): boolean => {
      if (fromMe) return paidOutgoingHashes.has(paymentHash) || paidHashes.has(paymentHash);
      return paidIncomingHashes.has(paymentHash);
    },
    [paidOutgoingHashes, paidIncomingHashes, paidHashes],
  );

  // Payment hashes of outgoing invoices that are plausibly still payable —
  // not expired, not already known paid, and (as a belt-and-braces cap)
  // not older than 24 h even if they claimed no expiry. That cap keeps the
  // polling loop from growing without bound across long-running sessions
  // where old unpaid invoices accumulate in the DM history.
  const POLL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const outgoingOpenHashes = useMemo(() => {
    const now = Date.now();
    const cutoff = now - POLL_MAX_AGE_MS;
    const hashes: string[] = [];
    for (const m of messages) {
      if (!m.fromMe) continue;
      if (m.createdAt * 1000 < cutoff) continue;
      const inv = extractInvoice(m.text);
      if (!inv || !inv.paymentHash) continue;
      if (paidOutgoingHashes.has(inv.paymentHash)) continue;
      if (paidHashes.has(inv.paymentHash)) continue;
      if (inv.expiresAt !== null && inv.expiresAt * 1000 < now) continue;
      hashes.push(inv.paymentHash);
    }
    return hashes;
  }, [messages, paidOutgoingHashes, paidHashes]);

  // Poll NWC for the paid status of outgoing invoices. Lightning-only.
  // Gated on `AppState === 'active'` so we don't burn battery or hammer
  // the relay while the app is backgrounded. We assume the active wallet
  // is the one that issued the invoice — not strictly true if the user
  // switched wallets mid-session, but a miss just means the UI stays
  // "unpaid" until the next wallet tx sync resolves it.
  useEffect(() => {
    if (!activeWalletId || activeWallet?.walletType === 'onchain') return;
    if (outgoingOpenHashes.length === 0) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      for (const hash of outgoingOpenHashes) {
        if (cancelled) return;
        const result = await nwcService.lookupInvoice(activeWalletId, hash);
        if (cancelled) return;
        if (result?.paid) {
          setPaidHashes((prev) => {
            if (prev.has(hash)) return prev;
            const next = new Set(prev);
            next.add(hash);
            return next;
          });
        }
      }
    };
    const start = () => {
      if (intervalId !== null) return;
      poll();
      intervalId = setInterval(poll, 15_000);
    };
    const stop = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') start();
      else stop();
    });
    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, [activeWalletId, activeWallet?.walletType, outgoingOpenHashes]);

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(false);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /**
   * Drives the per-message tick indicator (`MessageDeliveryStatus`).
   * Mutates the local-message record matching `localId` so the bubble
   * re-renders with the new tick state. The state-machine guard in
   * `nextDeliveryStatus` prevents a late callback from regressing a
   * message that's already been acked.
   */
  const updateDeliveryStatus = useCallback((localId: string, next: MessageDeliveryStatus) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === localId
          ? { ...m, deliveryStatus: nextDeliveryStatus(m.deliveryStatus ?? 'sending', next) }
          : m,
      ),
    );
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Optimistically render the bubble in the `sending` state so the
    // tick row paints immediately — the user can confirm the tap was
    // registered even on a slow relay path. The state flips to `sent`
    // or `failed` once `sendDirectMessage` resolves.
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Math.floor(Date.now() / 1000);
    setMessages((prev) => [
      ...prev,
      { id: localId, fromMe: true, text, createdAt, deliveryStatus: 'sending' },
    ]);
    setDraft('');
    try {
      const result = await sendDirectMessage(pubkey, text);
      updateDeliveryStatus(localId, deliveryStatusFromPublishResult(result.success));
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send message.');
      }
    } finally {
      setSending(false);
    }
  }, [draft, sending, sendDirectMessage, pubkey, updateDeliveryStatus]);

  const handleShareLocation = useCallback(async () => {
    if (sharingLocation) return;
    setAttachPanelOpen(false);
    setSharingLocation(true);
    try {
      const result = await getCurrentLocation();
      if (!result.ok) {
        Alert.alert('Could not share location', result.message);
        return;
      }
      const loc = result.location;
      await new Promise<void>((resolve) => {
        // `pressed` guards against `onDismiss` firing while a button's
        // onPress is still awaiting `sendDirectMessage`. Without it, the
        // outer Promise can resolve early, clear `sharingLocation`, and
        // re-enable the Attach button mid-publish — a classic double-submit
        // window we don't want.
        let pressed = false;
        Alert.alert(
          `Share location with ${name}?`,
          `${formatCoordsForDisplay(loc)}\n\nYour message will be end-to-end encrypted. ${name} will see a map preview from OpenStreetMap.`,
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => {
                pressed = true;
                resolve();
              },
            },
            {
              text: 'Share',
              style: 'default',
              onPress: async () => {
                pressed = true;
                const text = formatGeoMessage(loc);
                const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: localId,
                    fromMe: true,
                    text,
                    createdAt: Math.floor(Date.now() / 1000),
                    deliveryStatus: 'sending',
                  },
                ]);
                const sendResult = await sendDirectMessage(pubkey, text);
                updateDeliveryStatus(localId, deliveryStatusFromPublishResult(sendResult.success));
                if (!sendResult.success) {
                  Alert.alert('Send failed', sendResult.error ?? 'Could not send location.');
                }
                resolve();
              },
            },
          ],
          {
            cancelable: true,
            onDismiss: () => {
              if (!pressed) resolve();
            },
          },
        );
      });
    } finally {
      setSharingLocation(false);
    }
  }, [sharingLocation, name, pubkey, sendDirectMessage, updateDeliveryStatus]);

  // Shared send-image path for both gallery and camera entry points.
  // Strips EXIF from the picked image, uploads to the user's configured
  // Blossom server (or nostr.build fallback), then DMs the returned URL
  // to the conversation partner.
  const uploadAndSendImage = useCallback(
    async (localUri: string, pickerBase64?: string | null) => {
      setUploadingImage(true);
      try {
        const scrubbed = await stripImageMetadata(localUri, pickerBase64);
        const url = await uploadImage(scrubbed.uri, signEvent, scrubbed.base64);
        // Append optimistically in `sending` BEFORE awaiting the publish
        // so the bubble paints with a tick row immediately after upload
        // completes. Failure flips it to `failed` (red exclamation).
        const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setMessages((prev) => [
          ...prev,
          {
            id: localId,
            fromMe: true,
            text: url,
            createdAt: Math.floor(Date.now() / 1000),
            deliveryStatus: 'sending',
          },
        ]);
        const sendResult = await sendDirectMessage(pubkey, url);
        updateDeliveryStatus(localId, deliveryStatusFromPublishResult(sendResult.success));
        if (!sendResult.success) {
          Alert.alert('Send failed', sendResult.error ?? 'Could not send image.');
        }
      } catch (error) {
        Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setUploadingImage(false);
      }
    },
    [signEvent, sendDirectMessage, pubkey, updateDeliveryStatus],
  );

  const handlePickAndSendImage = useCallback(async () => {
    if (!isLoggedIn || uploadingImage || sending) return;
    setAttachPanelOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // Needed so stripImageMetadata can pass animated GIFs through
      // without re-encoding (expo-image-manipulator has no animated
      // output format). No-op for JPEG/PNG — those get re-encoded.
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendImage(result.assets[0].uri, result.assets[0].base64);
  }, [isLoggedIn, uploadingImage, sending, uploadAndSendImage]);

  const handleTakeAndSendPhoto = useCallback(async () => {
    if (!isLoggedIn || uploadingImage || sending) return;
    setAttachPanelOpen(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take and send photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      // Camera never captures GIF, but keep the shape consistent with the
      // gallery path — harmless for JPEG output.
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendImage(result.assets[0].uri, result.assets[0].base64);
  }, [isLoggedIn, uploadingImage, sending, uploadAndSendImage]);

  // Share another contact's Nostr profile into this conversation. Payload
  // mirrors the ContactProfileSheet → "Share with friend" format: a
  // human-readable first line plus a NIP-21 `nostr:nprofile…` URI that
  // other Nostr clients (Damus, Amethyst, Primal, …) render as a
  // clickable profile mention.
  const handleShareContactPicked = useCallback(
    async (friend: PickedFriend) => {
      // Dismiss both sheets in reverse stack order (top first).
      setContactPickerOpen(false);
      setAttachPanelOpen(false);
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const relayHints = buildProfileRelayHints(friend.pubkey, contacts, readRelays);
      const nprofile = nprofileEncode(friend.pubkey, relayHints);
      const label = friend.name || 'a contact';
      const payload = `Shared contact: ${label}\nnostr:${nprofile}`;
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          fromMe: true,
          text: payload,
          createdAt: Math.floor(Date.now() / 1000),
          deliveryStatus: 'sending',
        },
      ]);
      const result = await sendDirectMessage(pubkey, payload);
      updateDeliveryStatus(localId, deliveryStatusFromPublishResult(result.success));
      if (!result.success) {
        Alert.alert('Share failed', result.error ?? 'Could not share contact.');
      }
    },
    [pubkey, sendDirectMessage, contacts, relays, updateDeliveryStatus],
  );

  const handleSendGif = useCallback(
    async (gif: Gif) => {
      setGifPickerOpen(false);
      setAttachPanelOpen(false);
      const payload = gif.url;
      // `local-<ms>` on its own collides if two sends land in the same
      // millisecond (e.g. a double-tap on a slow network). Append a
      // short random suffix so the FlatList keyExtractor stays unique.
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          fromMe: true,
          text: payload,
          createdAt: Math.floor(Date.now() / 1000),
          deliveryStatus: 'sending',
        },
      ]);
      const result = await sendDirectMessage(pubkey, payload);
      updateDeliveryStatus(localId, deliveryStatusFromPublishResult(result.success));
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send GIF.');
      }
    },
    [pubkey, sendDirectMessage, updateDeliveryStatus],
  );

  const openLocation = useCallback((loc: SharedLocation) => {
    const url = buildOsmViewUrl(loc);
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', 'No browser is available to open OpenStreetMap.');
    });
  }, []);

  const handlePayInvoice = useCallback((raw: string) => {
    setInvoiceToPay(raw);
    setSendSheetOpen(true);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.kind === 'dayHeader') {
        return (
          <View style={styles.dayHeaderRow}>
            <View style={styles.dayHeaderRule} />
            <Text style={styles.dayHeaderText}>{item.label}</Text>
            <View style={styles.dayHeaderRule} />
          </View>
        );
      }
      // Wallet-derived zap variant — Lightning tx pulled from the wallet's
      // ledger, NOT a Nostr message. Stays inline because it's the only
      // 1:1-specific Item kind: groups don't pair zap receipts to a single
      // peer, so MessageBubble doesn't carry this case.
      if (item.kind === 'zap') {
        return (
          <View style={[styles.zapRow, item.fromMe ? styles.zapRowRight : styles.zapRowLeft]}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setDetailTx(item.tx)}
              style={[styles.zapCard, item.fromMe ? styles.zapCardMe : styles.zapCardThem]}
              accessibilityLabel={item.fromMe ? 'Zap sent' : 'Zap received'}
              testID={`conversation-zap-${item.id}`}
            >
              <View
                style={[
                  styles.zapCardIconBadge,
                  item.fromMe ? styles.zapCardIconBadgeMe : styles.zapCardIconBadgeThem,
                ]}
              >
                <Zap
                  size={18}
                  color={item.fromMe ? colors.brandPink : colors.white}
                  fill={item.fromMe ? colors.brandPink : colors.white}
                />
              </View>
              <View style={styles.zapCardBody}>
                <Text style={[styles.zapCardLabel, item.fromMe && styles.zapCardLabelMe]}>
                  {item.fromMe ? 'Zap sent' : 'Zap received'}
                </Text>
                <Text style={[styles.zapCardAmount, item.fromMe && styles.zapCardAmountMe]}>
                  {item.amountSats.toLocaleString()} sats
                </Text>
                {item.comment ? (
                  <Text style={[styles.zapCardComment, item.fromMe && styles.zapCardCommentMe]}>
                    {item.comment}
                  </Text>
                ) : null}
                <Text style={[styles.bubbleTime, item.fromMe && styles.bubbleTimeMe]}>
                  {formatTime(item.createdAt)}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        );
      }
      // Map the local Item shape to MessageBubble's `BubbleContent`. The
      // Items array was already classified upstream (see the items useMemo
      // that calls extractGifUrl + parseGeoMessage when assembling) so this
      // is a flat re-tag — MessageBubble handles the remaining text-format
      // detection (image / invoice / lnaddr / contact) on render.
      const content =
        item.kind === 'gif'
          ? ({ kind: 'gif', url: item.url } as const)
          : item.kind === 'location'
            ? ({ kind: 'location', location: item.location } as const)
            : ({ kind: 'text', text: item.text } as const);
      return (
        <MessageBubble
          id={item.id}
          fromMe={item.fromMe}
          createdAt={item.createdAt}
          content={content}
          sharedProfiles={sharedProfiles}
          isInvoicePaid={isInvoicePaid}
          onPayInvoice={handlePayInvoice}
          onPayLightningAddress={handlePayInvoice}
          onOpenContact={openSharedContact}
          onOpenLocation={openLocation}
          onOpenGifFullscreen={setFullscreenGifUrl}
          testIdPrefix="conversation"
          deliveryStatus={
            item.kind === 'message' || item.kind === 'gif' || item.kind === 'location'
              ? item.deliveryStatus
              : undefined
          }
        />
      );
    },
    [
      openLocation,
      isInvoicePaid,
      sharedProfiles,
      openSharedContact,
      handlePayInvoice,
      styles,
      colors,
    ],
  );

  const avatarNode =
    picture && !avatarError ? (
      <Image
        source={{ uri: picture }}
        style={styles.headerAvatar}
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
            setProfileContact({
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
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.brandPink} />
            <Text style={styles.loadingText}>Loading messages…</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
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

        {/* Composer + attach panel + IME-aware safe area now live in the
            shared ConversationComposer (#251). Both the 1:1 and group
            screens render through the same component so the keyboard
            wrapper, animated paddingBottom, and attach-panel placement
            can't drift again the way they did between v22 and v26. */}
        <ConversationComposer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
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
              onShareLocation={handleShareLocation}
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
            />
          }
        />
      </View>
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
          // ReceiveSheet does its own publish + already-success-only
          // notify, so this append is post-ack — paint as `sent` rather
          // than `sending` so the bubble doesn't flash a single grey
          // tick and immediately upgrade.
          setMessages((prev) => [
            ...prev,
            {
              id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              fromMe: true,
              text: payload,
              createdAt: Math.floor(Date.now() / 1000),
              deliveryStatus: 'sent',
            },
          ]);
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
          setProfileContact(contact);
        }}
      />
      <ContactProfileSheet
        visible={profileContact !== null}
        onClose={() => setProfileContact(null)}
        contact={profileContact}
        onMessage={
          profileContact && profileContact.pubkey !== pubkey
            ? () => {
                const c = profileContact;
                setProfileContact(null);
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
          profileContact?.lightningAddress
            ? () => {
                setProfileContact(null);
                setSendSheetOpen(true);
              }
            : undefined
        }
      />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      gap: 10,
    },
    backButton: {
      padding: 4,
    },
    headerPeer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
    },
    headerAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    listContent: {
      paddingHorizontal: 12,
      // Inverted list: paddingTop becomes the *visual-bottom* padding.
      // The composer (rendered inside KeyboardStickyView below) is a
      // flex sibling, so the FlatList's bottom edge already ends where
      // the composer's top begins — we don't need to clear the
      // composer's height here, just a small breathing gap so the
      // newest bubble doesn't visually hug the composer's top border.
      // ConversationScreen overrides this inline (16 dp) when the
      // attach panel is open. paddingBottom (= visual-top) keeps a
      // small breathing gap above the day-header row.
      paddingTop: 8,
      paddingBottom: 12,
      gap: 6,
      flexGrow: 1,
    },
    bubbleRow: {
      flexDirection: 'row',
      marginVertical: 2,
    },
    bubbleRowLeft: { justifyContent: 'flex-start' },
    bubbleRowRight: { justifyContent: 'flex-end' },
    dayHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 16,
      paddingBottom: 6,
      paddingHorizontal: 16,
      gap: 12,
    },
    // Wrapper is a centered lane hovering above the composer; the FAB
    // sits inside it so we can horizontally centre it without needing
    // to know the FAB's width. `pointerEvents="box-none"` lets taps
    // outside the button pass through to the message list below.
    scrollToBottomWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      // Lifts the FAB clear of the ~60 px composer by a comfortable gap
      // so it doesn't visually crowd the message input.
      bottom: 92,
      alignItems: 'center',
    },
    scrollToBottomFab: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPink,
      // White ring keeps the FAB visible when it overlaps a pink bubble
      // — otherwise the pink-on-pink blends into an invisible blob.
      borderWidth: 2,
      borderColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    },
    dayHeaderRule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
    },
    dayHeaderText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    // Bubble + per-message-type styles moved to MessageBubble.
    // bubbleTime / bubbleTimeMe stay here because the inline zap
    // renderer (1:1-only Item kind) still uses them for its time slug.
    bubbleTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    bubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    zapRow: {
      flexDirection: 'row',
      marginVertical: 4,
    },
    zapRowLeft: { justifyContent: 'flex-start' },
    zapRowRight: { justifyContent: 'flex-end' },
    zapCard: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: '85%',
      minWidth: 240,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    zapCardMe: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    zapCardThem: {
      backgroundColor: colors.surface,
      borderColor: colors.zapYellow,
    },
    zapCardIconBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    zapCardIconBadgeMe: {
      backgroundColor: colors.white,
    },
    zapCardIconBadgeThem: {
      backgroundColor: colors.zapYellow,
    },
    zapCardBody: {
      flex: 1,
    },
    zapCardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    zapCardLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    zapCardLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    zapCardTime: {
      fontSize: 10,
      color: colors.textSupplementary,
    },
    zapCardTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    zapCardAmount: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 2,
    },
    zapCardAmountMe: {
      color: colors.white,
    },
    zapCardComment: {
      fontSize: 14,
      color: colors.textBody,
      marginTop: 4,
    },
    zapCardCommentMe: {
      color: colors.white,
    },
    // composer + composerInput + composerSendButton + composerAttachButton
    // moved to ConversationComposer (#251) — kept in sync with the group
    // screen via that shared component.
    // gifCard / gifImage / gifTime / locationCard / locationMap /
    // locationBody / locationLabel / locationCoords / locationAccuracy /
    // imageBubble + bg / time variants moved to MessageBubble. The
    // fullscreen-modal styles below are still used by the Modal that
    // expands a tapped GIF, which lives at the screen level.
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
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    loadingText: {
      color: colors.textSupplementary,
      fontSize: 14,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 6,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
    },
  });

export default ConversationScreen;
