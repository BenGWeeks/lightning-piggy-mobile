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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import ZapIcon from '../components/icons/ZapIcon';
import SendSheet from '../components/SendSheet';
import TransactionDetailSheet, {
  TransactionDetailData,
} from '../components/TransactionDetailSheet';
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

  const { isLoggedIn, fetchConversation, sendDirectMessage } = useNostr();
  const { wallets } = useWallet();

  const [messages, setMessages] = useState<
    { id: string; fromMe: boolean; text: string; createdAt: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [detailTx, setDetailTx] = useState<TransactionDetailData | null>(null);
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
          amountSats: tx.amount,
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

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item.kind === 'message') {
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
            <ZapIcon size={18} color={item.fromMe ? colors.brandPink : colors.white} />
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
            <ZapIcon size={20} color={colors.white} />
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
              <ZapIcon size={22} color={colors.white} />
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
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                    stroke={colors.white}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      <SendSheet
        visible={sendSheetOpen}
        onClose={() => {
          setSendSheetOpen(false);
          handleRefresh();
        }}
        initialAddress={lightningAddress ?? undefined}
        initialPicture={picture ?? undefined}
        recipientPubkey={pubkey}
        recipientName={name}
      />
      <TransactionDetailSheet
        visible={detailTx !== null}
        tx={detailTx}
        onClose={() => setDetailTx(null)}
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
