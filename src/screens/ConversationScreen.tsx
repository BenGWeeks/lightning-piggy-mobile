import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Image,
  Linking,
  StyleSheet,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Zap, Send, Plus, MapPin } from 'lucide-react-native';
import { Image as ExpoImage } from 'expo-image';
import { decode as bolt11Decode } from 'light-bolt11-decoder';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import * as nwcService from '../services/nwcService';
import { colors } from '../styles/theme';
import SendSheet from '../components/SendSheet';
import AttachSheet from '../components/AttachSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import TransactionDetailSheet, {
  TransactionDetailData,
  CounterpartyContact,
} from '../components/TransactionDetailSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import {
  getCurrentLocation,
  formatGeoMessage,
  parseGeoMessage,
  buildOsmViewUrl,
  buildStaticMapUrl,
  formatCoordsForDisplay,
  USER_AGENT,
  SharedLocation,
} from '../services/locationService';
import type { RootStackParamList } from '../navigation/types';

type ConversationRoute = RouteProp<RootStackParamList, 'Conversation'>;
type ConversationNavigation = NativeStackNavigationProp<RootStackParamList, 'Conversation'>;

type Item =
  | {
      kind: 'message';
      id: string;
      fromMe: boolean;
      text: string;
      createdAt: number;
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
    };

// Bolt11 invoices are self-identifying by their `lnXX` HRP, so detection
// here matches them with or without the `lightning:` prefix.
const INVOICE_REGEX = /\b(?:lightning:)?(ln(?:bc|tb|ts|bs)[0-9a-z]{50,})\b/i;

// Lightning addresses look like plain email addresses — `alice@example.com`
// — so we only treat a message as a payable LN address when the sender
// explicitly prefixes it with `lightning:`. Otherwise we'd turn every
// shared email into a Pay button and guess wrong.
const LN_ADDRESS_REGEX = /lightning:([a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i;

interface DecodedInvoice {
  raw: string;
  amountSats: number | null;
  description: string | null;
  /** Epoch seconds at which the invoice becomes invalid. `null` = unknown. */
  expiresAt: number | null;
  /** 32-byte payment hash (hex). Used to poll NWC for paid status. */
  paymentHash: string | null;
}

function extractInvoice(text: string): DecodedInvoice | null {
  if (!text) return null;
  const match = text.match(INVOICE_REGEX);
  if (!match) return null;
  const raw = match[1];
  try {
    const decoded = bolt11Decode(raw);
    let amountSats: number | null = null;
    let description: string | null = null;
    let timestamp: number | null = null;
    let expirySeconds: number | null = null;
    let paymentHash: string | null = null;
    for (const section of decoded.sections) {
      if (section.name === 'amount') {
        amountSats = Math.round(Number(section.value) / 1000);
      } else if (section.name === 'description') {
        description = section.value as string;
      } else if (section.name === 'timestamp') {
        timestamp = section.value as number;
      } else if (section.name === 'expiry') {
        expirySeconds = section.value as number;
      } else if (section.name === 'payment_hash') {
        paymentHash = section.value as string;
      }
    }
    const expiresAt =
      timestamp !== null && expirySeconds !== null ? timestamp + expirySeconds : null;
    return { raw, amountSats, description, expiresAt, paymentHash };
  } catch {
    return { raw, amountSats: null, description: null, expiresAt: null, paymentHash: null };
  }
}

function extractLightningAddress(text: string): string | null {
  if (!text) return null;
  const match = text.match(LN_ADDRESS_REGEX);
  return match ? match[1] : null;
}

function formatTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month} ${hh}:${mm}`;
}

function formatRelativeFuture(epochMs: number): string {
  const deltaSec = Math.max(0, Math.floor((epochMs - Date.now()) / 1000));
  if (deltaSec < 60) return 'in <1 min';
  if (deltaSec < 3600) return `in ${Math.floor(deltaSec / 60)} min`;
  if (deltaSec < 86400) return `in ${Math.floor(deltaSec / 3600)}h`;
  return `in ${Math.floor(deltaSec / 86400)}d`;
}

const ConversationScreen: React.FC = () => {
  const navigation = useNavigation<ConversationNavigation>();
  const route = useRoute<ConversationRoute>();
  const insets = useSafeAreaInsets();
  const { pubkey, name, picture, lightningAddress } = route.params;

  const { isLoggedIn, fetchConversation, sendDirectMessage } = useNostr();
  const { wallets, activeWalletId, activeWallet } = useWallet();

  const [messages, setMessages] = useState<
    { id: string; fromMe: boolean; text: string; createdAt: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [invoiceToPay, setInvoiceToPay] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [detailTx, setDetailTx] = useState<TransactionDetailData | null>(null);
  const [profileContact, setProfileContact] = useState<CounterpartyContact | null>(null);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [invoiceSheetOpen, setInvoiceSheetOpen] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  // Payment hashes of outgoing invoices the active NWC wallet reports paid.
  const [paidHashes, setPaidHashes] = useState<Set<string>>(() => new Set());
  const listRef = useRef<FlatList<Item>>(null);

  const zapItems = useMemo<Item[]>(() => {
    const out: Item[] = [];
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
    const msgItems: Item[] = messages.map((m) => {
      const loc = parseGeoMessage(m.text);
      if (loc) {
        return {
          kind: 'location',
          id: `dm-${m.id}`,
          fromMe: m.fromMe,
          location: loc,
          createdAt: m.createdAt,
        };
      }
      return {
        kind: 'message',
        id: `dm-${m.id}`,
        fromMe: m.fromMe,
        text: m.text,
        createdAt: m.createdAt,
      };
    });
    // Descending order — index 0 is newest. The FlatList is `inverted`, so
    // index 0 renders at the visual bottom (chat default) and the
    // RefreshControl attaches to the visual bottom too, which is what
    // drives the pull-up-to-refresh gesture.
    return [...msgItems, ...zapItems].sort((a, b) => b.createdAt - a.createdAt);
  }, [messages, zapItems]);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (!isLoggedIn) {
        setLoading(false);
        return;
      }
      if (showSpinner) setLoading(true);
      try {
        const conv = await fetchConversation(pubkey);
        setMessages(conv);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [isLoggedIn, fetchConversation, pubkey],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Jump to the newest message on first content load. The list is
  // `inverted`, so offset 0 is the visual bottom (data[0] = newest).
  // A plain `scrollToEnd` would land on the oldest message.
  useEffect(() => {
    if (items.length === 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [items.length]);

  // Payment hashes of outgoing invoices that are plausibly still payable —
  // not expired and not already known paid. Memoised so the polling effect
  // doesn't re-run on every render.
  const outgoingOpenHashes = useMemo(() => {
    const now = Date.now();
    const hashes: string[] = [];
    for (const m of messages) {
      if (!m.fromMe) continue;
      const inv = extractInvoice(m.text);
      if (!inv || !inv.paymentHash) continue;
      if (paidHashes.has(inv.paymentHash)) continue;
      if (inv.expiresAt !== null && inv.expiresAt * 1000 < now) continue;
      hashes.push(inv.paymentHash);
    }
    return hashes;
  }, [messages, paidHashes]);

  // Payment hashes known paid from our wallet's own transaction history.
  // Covers both directions of the conversation:
  //   - Invoice we sent, counterparty paid → appears as an *incoming* tx
  //     on our wallet, carrying the invoice's payment_hash.
  //   - Invoice we received, we paid → appears as an *outgoing* tx,
  //     also carrying the same payment_hash.
  // This avoids a per-invoice NWC lookupInvoice poll; the wallet tx list
  // is already kept in sync and recomputes for free whenever it updates.
  const paidFromWalletHashes = useMemo(() => {
    const hashes = new Set<string>();
    for (const w of wallets) {
      for (const tx of w.transactions) {
        if (tx.paymentHash) hashes.add(tx.paymentHash);
      }
    }
    return hashes;
  }, [wallets]);

  // Unified paid set for rendering: NWC-polled settled outgoing invoices +
  // anything our wallet's tx history has already recorded (either direction).
  const allPaidHashes = useMemo(() => {
    const merged = new Set(paidHashes);
    paidFromWalletHashes.forEach((h) => merged.add(h));
    return merged;
  }, [paidHashes, paidFromWalletHashes]);

  // Poll NWC for the paid status of outgoing invoices. Lightning-only.
  // We assume the active wallet is the one that issued the invoice — not
  // strictly true if the user switched wallets mid-session, but the cost
  // of a miss is that a paid invoice stays "unpaid" in the UI.
  useEffect(() => {
    if (!activeWalletId || activeWallet?.walletType === 'onchain') return;
    if (outgoingOpenHashes.length === 0) return;
    let cancelled = false;
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
    poll();
    const id = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeWalletId, activeWallet?.walletType, outgoingOpenHashes]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(false);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const result = await sendDirectMessage(pubkey, text);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send message.');
        return;
      }
      setDraft('');
      const optimistic = {
        id: `local-${Date.now()}`,
        fromMe: true,
        text,
        createdAt: Math.floor(Date.now() / 1000),
      };
      setMessages((prev) => [...prev, optimistic]);
    } finally {
      setSending(false);
    }
  }, [draft, sending, sendDirectMessage, pubkey]);

  const handleOpenZap = useCallback(() => {
    if (!lightningAddress) {
      Alert.alert('No Lightning address', `${name} does not have a Lightning address.`);
      return;
    }
    setSendSheetOpen(true);
  }, [lightningAddress, name]);

  const handleShareLocation = useCallback(async () => {
    if (sharingLocation) return;
    setAttachSheetOpen(false);
    setSharingLocation(true);
    try {
      const result = await getCurrentLocation();
      if (!result.ok) {
        Alert.alert('Could not share location', result.message);
        return;
      }
      const loc = result.location;
      await new Promise<void>((resolve) => {
        Alert.alert(
          `Share location with ${name}?`,
          `${formatCoordsForDisplay(loc)}\n\nYour message will be end-to-end encrypted. ${name} will see a map preview from OpenStreetMap.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
            {
              text: 'Share',
              style: 'default',
              onPress: async () => {
                const text = formatGeoMessage(loc);
                const sendResult = await sendDirectMessage(pubkey, text);
                if (!sendResult.success) {
                  Alert.alert('Send failed', sendResult.error ?? 'Could not send location.');
                } else {
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `local-${Date.now()}`,
                      fromMe: true,
                      text,
                      createdAt: Math.floor(Date.now() / 1000),
                    },
                  ]);
                }
                resolve();
              },
            },
          ],
          { cancelable: true, onDismiss: () => resolve() },
        );
      });
    } finally {
      setSharingLocation(false);
    }
  }, [sharingLocation, name, pubkey, sendDirectMessage]);

  const openLocation = useCallback((loc: SharedLocation) => {
    const url = buildOsmViewUrl(loc);
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', 'No browser is available to open OpenStreetMap.');
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.kind === 'message') {
        const invoice = extractInvoice(item.text);
        if (invoice) {
          const expired = invoice.expiresAt !== null && invoice.expiresAt * 1000 < Date.now();
          const paid = invoice.paymentHash !== null && allPaidHashes.has(invoice.paymentHash);
          return (
            <View
              style={[styles.bubbleRow, item.fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}
            >
              <View
                style={[
                  styles.invoiceCard,
                  item.fromMe ? styles.invoiceCardMe : styles.invoiceCardThem,
                ]}
              >
                <View style={styles.invoiceHeaderRow}>
                  <Text style={[styles.invoiceLabel, item.fromMe && styles.invoiceLabelMe]}>
                    {item.fromMe ? 'Invoice sent' : 'Invoice received'}
                  </Text>
                  <Text style={[styles.bubbleTime, item.fromMe && styles.bubbleTimeMe]}>
                    {formatTime(item.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.invoiceAmount, item.fromMe && styles.invoiceAmountMe]}>
                  {invoice.amountSats !== null
                    ? `${invoice.amountSats.toLocaleString()} sats`
                    : 'Any amount'}
                </Text>
                {invoice.description ? (
                  <Text
                    style={[styles.invoiceMemo, item.fromMe && styles.invoiceMemoMe]}
                    numberOfLines={2}
                  >
                    {invoice.description}
                  </Text>
                ) : null}
                <View style={styles.invoiceTagRow}>
                  {paid ? (
                    <View style={[styles.invoiceTag, styles.invoiceTagPaid]}>
                      <Text style={styles.invoiceTagPaidText}>Paid</Text>
                    </View>
                  ) : expired ? (
                    <View style={[styles.invoiceTag, styles.invoiceTagExpired]}>
                      <Text style={styles.invoiceTagExpiredText}>Expired</Text>
                    </View>
                  ) : item.fromMe ? (
                    <View style={[styles.invoiceTag, styles.invoiceTagUnpaid]}>
                      <Text style={styles.invoiceTagUnpaidText}>Unpaid</Text>
                    </View>
                  ) : null}
                  {!paid && !expired && invoice.expiresAt !== null ? (
                    <Text style={[styles.invoiceExpiry, item.fromMe && styles.invoiceExpiryMe]}>
                      expires {formatRelativeFuture(invoice.expiresAt * 1000)}
                    </Text>
                  ) : null}
                </View>
                {item.fromMe ? null : paid || expired ? null : (
                  <TouchableOpacity
                    style={styles.invoicePayButton}
                    onPress={() => {
                      setInvoiceToPay(invoice.raw);
                      setSendSheetOpen(true);
                    }}
                    accessibilityLabel="Pay this invoice"
                    testID={`conversation-pay-${item.id}`}
                  >
                    <Zap size={16} color={colors.white} fill={colors.white} />
                    <Text style={styles.invoicePayText}>Pay</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }
        const lnAddress = extractLightningAddress(item.text);
        if (lnAddress) {
          return (
            <View
              style={[styles.bubbleRow, item.fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}
            >
              <View
                style={[
                  styles.invoiceCard,
                  item.fromMe ? styles.invoiceCardMe : styles.invoiceCardThem,
                ]}
              >
                <View style={styles.invoiceHeaderRow}>
                  <Text style={[styles.invoiceLabel, item.fromMe && styles.invoiceLabelMe]}>
                    {item.fromMe ? 'Address sent' : 'Lightning address'}
                  </Text>
                  <Text style={[styles.bubbleTime, item.fromMe && styles.bubbleTimeMe]}>
                    {formatTime(item.createdAt)}
                  </Text>
                </View>
                <Text
                  style={[styles.invoiceMemo, item.fromMe && styles.invoiceMemoMe]}
                  numberOfLines={1}
                >
                  {lnAddress}
                </Text>
                {item.fromMe ? null : (
                  <TouchableOpacity
                    style={styles.invoicePayButton}
                    onPress={() => {
                      setInvoiceToPay(lnAddress);
                      setSendSheetOpen(true);
                    }}
                    accessibilityLabel="Pay this lightning address"
                    testID={`conversation-pay-${item.id}`}
                  >
                    <Zap size={16} color={colors.white} fill={colors.white} />
                    <Text style={styles.invoicePayText}>Pay</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }
        return (
          <View
            style={[styles.bubbleRow, item.fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}
          >
            <View style={[styles.bubble, item.fromMe ? styles.bubbleMe : styles.bubbleThem]}>
              <Text style={[styles.bubbleText, item.fromMe && styles.bubbleTextMe]}>
                {item.text}
              </Text>
              <Text style={[styles.bubbleTime, item.fromMe && styles.bubbleTimeMe]}>
                {formatTime(item.createdAt)}
              </Text>
            </View>
          </View>
        );
      }
      if (item.kind === 'location') {
        const { location } = item;
        const mapUrl = buildStaticMapUrl(location);
        return (
          <View
            style={[styles.bubbleRow, item.fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => openLocation(location)}
              style={[
                styles.locationCard,
                item.fromMe ? styles.locationCardMe : styles.locationCardThem,
              ]}
              accessibilityLabel={item.fromMe ? 'Location sent' : 'Location received'}
              testID={`conversation-location-${item.id}`}
            >
              <ExpoImage
                source={{ uri: mapUrl, headers: { 'User-Agent': USER_AGENT } }}
                style={styles.locationMap}
                contentFit="cover"
                cachePolicy="disk"
                transition={150}
                accessibilityIgnoresInvertColors
              />
              <View style={styles.locationBody}>
                <View style={styles.locationHeaderRow}>
                  <View style={styles.locationLabelRow}>
                    <MapPin
                      size={14}
                      color={item.fromMe ? 'rgba(255,255,255,0.85)' : colors.textSupplementary}
                    />
                    <Text style={[styles.locationLabel, item.fromMe && styles.locationLabelMe]}>
                      {item.fromMe ? 'Location sent' : 'Location'}
                    </Text>
                  </View>
                  <Text style={[styles.bubbleTime, item.fromMe && styles.bubbleTimeMe]}>
                    {formatTime(item.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.locationCoords, item.fromMe && styles.locationCoordsMe]}>
                  {formatCoordsForDisplay(location)}
                </Text>
                {location.accuracyMeters !== null ? (
                  <Text style={[styles.locationAccuracy, item.fromMe && styles.locationAccuracyMe]}>
                    ± {location.accuracyMeters} m · OpenStreetMap
                  </Text>
                ) : (
                  <Text style={[styles.locationAccuracy, item.fromMe && styles.locationAccuracyMe]}>
                    OpenStreetMap
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        );
      }
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
              <View style={styles.zapCardHeaderRow}>
                <Text style={[styles.zapCardLabel, item.fromMe && styles.zapCardLabelMe]}>
                  {item.fromMe ? 'Zap sent' : 'Zap received'}
                </Text>
                <Text style={[styles.zapCardTime, item.fromMe && styles.zapCardTimeMe]}>
                  {formatTime(item.createdAt)}
                </Text>
              </View>
              <Text style={[styles.zapCardAmount, item.fromMe && styles.zapCardAmountMe]}>
                {item.amountSats.toLocaleString()} sats
              </Text>
              {item.comment ? (
                <Text style={[styles.zapCardComment, item.fromMe && styles.zapCardCommentMe]}>
                  {item.comment}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        </View>
      );
    },
    [openLocation, allPaidHashes],
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
        {avatarNode}
        <Text style={styles.headerName} numberOfLines={1}>
          {name}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
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
            contentContainerStyle={styles.listContent}
            inverted
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySubtitle}>
                  Say hi{lightningAddress ? ' — or send a zap.' : '.'}
                </Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          />
        )}

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TouchableOpacity
            style={styles.composerAttachButton}
            onPress={() => setAttachSheetOpen(true)}
            disabled={!isLoggedIn || sending || sharingLocation}
            accessibilityLabel="Attach"
            testID="conversation-attach"
          >
            {sharingLocation ? (
              <ActivityIndicator color={colors.brandPink} />
            ) : (
              <Plus size={22} color={colors.brandPink} />
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.composerInput}
            placeholder="Message"
            placeholderTextColor={colors.textSupplementary}
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={isLoggedIn && !sending}
            accessibilityLabel="Message input"
            testID="conversation-input"
          />
          <TouchableOpacity
            style={[
              styles.composerSendButton,
              (!draft.trim() || sending) && styles.composerSendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            accessibilityLabel="Send message"
            testID="conversation-send"
          >
            {sending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Send size={20} color={colors.white} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <AttachSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        onShareLocation={handleShareLocation}
        onSendZap={
          lightningAddress
            ? () => {
                setAttachSheetOpen(false);
                setSendSheetOpen(true);
              }
            : undefined
        }
        onSendInvoice={() => {
          setAttachSheetOpen(false);
          setInvoiceSheetOpen(true);
        }}
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
          setMessages((prev) => [
            ...prev,
            {
              id: `local-${Date.now()}`,
              fromMe: true,
              text: payload,
              createdAt: Math.floor(Date.now() / 1000),
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

const styles = StyleSheet.create({
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
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: 10,
  },
  backButton: {
    padding: 4,
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
    paddingVertical: 12,
    gap: 6,
    flexGrow: 1,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 2,
  },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  bubbleThem: {
    backgroundColor: colors.white,
    borderBottomLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: colors.brandPink,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    color: colors.textBody,
    lineHeight: 20,
  },
  bubbleTextMe: {
    color: colors.white,
  },
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
    paddingVertical: 12,
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
    backgroundColor: colors.white,
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
    fontSize: 11,
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
  invoiceCard: {
    maxWidth: '85%',
    minWidth: 240,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  invoiceCardMe: {
    backgroundColor: colors.brandPink,
    borderColor: colors.brandPink,
  },
  invoiceCardThem: {
    backgroundColor: colors.white,
    borderColor: colors.zapYellow,
  },
  invoiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  invoiceLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSupplementary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  invoiceLabelMe: {
    color: 'rgba(255,255,255,0.85)',
  },
  invoiceAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textHeader,
    marginTop: 2,
  },
  invoiceAmountMe: {
    color: colors.white,
  },
  invoiceMemo: {
    fontSize: 14,
    color: colors.textBody,
    marginTop: 2,
  },
  invoiceMemoMe: {
    color: 'rgba(255,255,255,0.9)',
  },
  invoiceExpiry: {
    fontSize: 12,
    color: colors.textSupplementary,
    marginTop: 4,
  },
  invoiceExpiryMe: {
    color: 'rgba(255,255,255,0.75)',
  },
  invoiceTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  invoiceTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  invoiceTagPaid: {
    backgroundColor: '#2e7d32',
  },
  invoiceTagPaidText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  invoiceTagUnpaid: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  invoiceTagUnpaidText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  invoiceTagExpired: {
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  invoiceTagExpiredText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  invoicePayButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.brandPink,
  },
  invoicePayButtonDisabled: {
    backgroundColor: colors.divider,
  },
  invoicePayText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  invoicePayExpiredText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSupplementary,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 8,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: colors.textBody,
  },
  composerSendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerSendButtonDisabled: {
    opacity: 0.4,
  },
  composerAttachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  locationCard: {
    maxWidth: '85%',
    minWidth: 240,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  locationCardMe: {
    backgroundColor: colors.brandPink,
    borderColor: colors.brandPink,
  },
  locationCardThem: {
    backgroundColor: colors.white,
    borderColor: colors.divider,
  },
  locationMap: {
    width: '100%',
    height: 140,
    backgroundColor: colors.background,
  },
  locationBody: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  locationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  locationLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSupplementary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  locationLabelMe: {
    color: 'rgba(255,255,255,0.85)',
  },
  locationCoords: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textHeader,
    marginTop: 2,
  },
  locationCoordsMe: {
    color: colors.white,
  },
  locationAccuracy: {
    fontSize: 12,
    color: colors.textSupplementary,
  },
  locationAccuracyMe: {
    color: 'rgba(255,255,255,0.85)',
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
