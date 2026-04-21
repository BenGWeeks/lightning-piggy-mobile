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
  StyleSheet,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Zap, Send, ImagePlus } from 'lucide-react-native';
import { decode as bolt11Decode } from 'light-bolt11-decoder';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { uploadImage } from '../services/imageUploadService';
import SendSheet from '../components/SendSheet';
import TransactionDetailSheet, {
  TransactionDetailData,
  CounterpartyContact,
} from '../components/TransactionDetailSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
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
    };

// Bolt11 invoices are self-identifying by their `lnXX` HRP, so detection
// here matches them with or without the `lightning:` prefix.
const INVOICE_REGEX = /\b(?:lightning:)?(ln(?:bc|tb|ts|bs)[0-9a-z]{50,})\b/i;

// Image URLs we render inline in message bubbles. We only match trusted image
// extensions so we don't accidentally fetch arbitrary URLs as images.
const IMAGE_URL_REGEX = /^(https?:\/\/\S+?\.(?:png|jpe?g|gif|webp|heic|heif))(?:\?\S*)?$/i;

function extractImageUrl(text: string): string | null {
  if (!text) return null;
  // Only treat a message as an image when the entire body is the URL. This
  // avoids silently dropping surrounding text like "check this https://…jpg".
  const trimmed = text.trim();
  const match = trimmed.match(IMAGE_URL_REGEX);
  return match ? match[0] : null;
}

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
    for (const section of decoded.sections) {
      if (section.name === 'amount') {
        amountSats = Math.round(Number(section.value) / 1000);
      } else if (section.name === 'description') {
        description = section.value as string;
      } else if (section.name === 'timestamp') {
        timestamp = section.value as number;
      } else if (section.name === 'expiry') {
        expirySeconds = section.value as number;
      }
    }
    const expiresAt =
      timestamp !== null && expirySeconds !== null ? timestamp + expirySeconds : null;
    return { raw, amountSats, description, expiresAt };
  } catch {
    return { raw, amountSats: null, description: null, expiresAt: null };
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

const ConversationScreen: React.FC = () => {
  const navigation = useNavigation<ConversationNavigation>();
  const route = useRoute<ConversationRoute>();
  const insets = useSafeAreaInsets();
  const { pubkey, name, picture, lightningAddress } = route.params;

  const { isLoggedIn, fetchConversation, sendDirectMessage, signEvent } = useNostr();
  const { wallets } = useWallet();

  const [messages, setMessages] = useState<
    { id: string; fromMe: boolean; text: string; createdAt: number }[]
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
    const msgItems: Item[] = messages.map((m) => ({
      kind: 'message',
      id: `dm-${m.id}`,
      fromMe: m.fromMe,
      text: m.text,
      createdAt: m.createdAt,
    }));
    return [...msgItems, ...zapItems].sort((a, b) => a.createdAt - b.createdAt);
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

  useEffect(() => {
    if (items.length === 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [items.length]);

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

  const handlePickAndSendImage = useCallback(async () => {
    if (!isLoggedIn || uploadingImage || sending) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingImage(true);
    try {
      const url = await uploadImage(result.assets[0].uri, signEvent);
      const sendResult = await sendDirectMessage(pubkey, url);
      if (!sendResult.success) {
        Alert.alert('Send failed', sendResult.error ?? 'Could not send image.');
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          fromMe: true,
          text: url,
          createdAt: Math.floor(Date.now() / 1000),
        },
      ]);
    } catch (error) {
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setUploadingImage(false);
    }
  }, [isLoggedIn, uploadingImage, sending, signEvent, sendDirectMessage, pubkey]);

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item.kind === 'message') {
      const imageUrl = extractImageUrl(item.text);
      if (imageUrl) {
        return (
          <View
            style={[styles.bubbleRow, item.fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}
          >
            <View style={styles.imageBubble}>
              <Image
                source={{ uri: imageUrl }}
                style={styles.imageBubbleImage}
                resizeMode="cover"
                accessibilityLabel="Shared image"
              />
              {/* Image bubble background is always white, so keep the default
                  (darker) bubbleTime colour for both sides — bubbleTimeMe is
                  near-white and would be illegible here. */}
              <Text style={[styles.bubbleTime, styles.imageBubbleTime]}>
                {formatTime(item.createdAt)}
              </Text>
            </View>
          </View>
        );
      }
      const invoice = extractInvoice(item.text);
      if (invoice) {
        const expired = invoice.expiresAt !== null && invoice.expiresAt * 1000 < Date.now();
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
                  {item.fromMe ? 'Invoice sent' : 'Invoice'}
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
              {item.fromMe ? null : expired ? (
                <View style={[styles.invoicePayButton, styles.invoicePayButtonDisabled]}>
                  <Text style={styles.invoicePayExpiredText}>Expired</Text>
                </View>
              ) : (
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
            <Text style={[styles.bubbleText, item.fromMe && styles.bubbleTextMe]}>{item.text}</Text>
            <Text style={[styles.bubbleTime, item.fromMe && styles.bubbleTimeMe]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
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
  }, []);

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
        {lightningAddress ? (
          <TouchableOpacity
            onPress={handleOpenZap}
            style={styles.zapHeaderButton}
            accessibilityLabel="Send zap"
            testID="conversation-zap"
          >
            <Zap size={20} color={colors.white} fill={colors.white} />
          </TouchableOpacity>
        ) : null}
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
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySubtitle}>
                  Say hi{lightningAddress ? ' — or send a zap.' : '.'}
                </Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            onContentSizeChange={() => {
              if (items.length > 0) listRef.current?.scrollToEnd({ animated: false });
            }}
          />
        )}

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TouchableOpacity
            style={[
              styles.composerImageButton,
              (!isLoggedIn || sending || uploadingImage) && styles.composerSendButtonDisabled,
            ]}
            onPress={handlePickAndSendImage}
            disabled={!isLoggedIn || sending || uploadingImage}
            accessibilityLabel="Send image"
            testID="conversation-image"
          >
            {uploadingImage ? (
              <ActivityIndicator color={colors.brandPink} />
            ) : (
              <ImagePlus size={22} color={colors.brandPink} />
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
          {lightningAddress && draft.trim().length === 0 ? (
            <TouchableOpacity
              style={styles.composerZapButton}
              onPress={handleOpenZap}
              accessibilityLabel="Send zap"
              testID="conversation-composer-zap"
            >
              <Zap size={22} color={colors.white} fill={colors.white} />
            </TouchableOpacity>
          ) : (
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
          )}
        </View>
      </KeyboardAvoidingView>

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
  zapHeaderButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandPink,
    alignItems: 'center',
    justifyContent: 'center',
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
  composerZapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerImageButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  imageBubble: {
    maxWidth: '80%',
    padding: 4,
    borderRadius: 16,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  imageBubbleImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  imageBubbleTime: {
    paddingHorizontal: 6,
    paddingBottom: 4,
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
