import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  type ListRenderItemInfo,
} from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { t as translate } from '../i18n';
import { satsToFiatString } from '../services/fiatService';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
import { useNostrContacts } from '../contexts/NostrContext';
import ContactProfileSheet from './ContactProfileSheet';
import type { ContactProfileBodyData } from './ContactProfileBody';
import TransactionDetailSheet, {
  TransactionDetailData,
  CounterpartyContact,
} from './TransactionDetailSheet';
import SendSheet from './SendSheet';
import TransactionTypeIcon, { TransactionIconState } from './TransactionTypeIcon';
import { swapIconState } from '../utils/swapIconState';
import { getTxCategory } from '../utils/txCategory';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { isSupportedImageUrl } from '../utils/imageUrl';
import type { WalletTransaction, ZapCounterpartyInfo } from '../types/wallet';
import { perfLog } from '../utils/perfLog';
import type { RootStackParamList } from '../navigation/types';
import { AVATAR_SIZE, createTransactionListStyles } from '../styles/TransactionList.styles';
import {
  buildTransactionRows,
  hasMoreTransactions,
  nextPage,
  sortTransactions,
  windowTransactions,
  INITIAL_PAGE_SIZE,
  type TxRow,
} from '../utils/transactionPagination';

interface Props {
  transactions: WalletTransaction[];
  // Forwarded to the FlatList so Home's pull-to-refresh keeps working now
  // that the list is the scroller (it used to live on Home's ScrollView).
  refreshControl?: React.ReactElement<RefreshControlProps>;
}

function zapCounterpartyLabel(cp: ZapCounterpartyInfo): string {
  if (cp.anonymous) return translate('transactionList.anonymous');
  const profile = cp.profile;
  if (profile?.displayName) return profile.displayName;
  if (profile?.name) return profile.name;
  if (profile?.npub) return `${profile.npub.slice(0, 12)}…`;
  return translate('transactionList.nostrUser');
}

// Parse URL-shaped descriptions into `{ primary, subtitle }` so a row like
// "https://memestore.satmo-dev.xyz - Order #4497" renders with the domain
// prominent and the full URL/memo below, matching Primal's treatment.
function splitDescription(desc: string): { primary: string; subtitle: string | null } {
  const trimmed = desc.trim();
  const urlMatch = trimmed.match(/^(https?:\/\/)([^\s/]+)(.*)$/i);
  if (urlMatch) {
    const [, , host, rest] = urlMatch;
    return { primary: host, subtitle: rest.replace(/^\s*-\s*/, '').trim() || null };
  }
  return { primary: trimmed, subtitle: null };
}

function formatDayHeader(ts: number): string {
  const date = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return translate('transactionList.today');
  if (sameDay(date, yesterday)) return translate('transactionList.yesterday');
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const TransactionList: React.FC<Props> = ({ transactions, refreshControl }) => {
  // Per-mount first-render marker. The previous module-scope `let`
  // never reset, so navigating away + back (or switching wallets,
  // which forces a remount via the activeWalletId effect) silently
  // dropped the perf log on every subsequent mount.
  const firstRenderLogged = useRef(false);
  if (!firstRenderLogged.current) {
    firstRenderLogged.current = true;
    perfLog(`TransactionList first render (${transactions.length} txs)`);
  }
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createTransactionListStyles(colors), [colors]);
  const { currency, activeWalletId } = useWallet();
  const { btcPrice } = useWalletLive();
  const { contacts } = useNostrContacts();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // When contacts' profiles refresh, we want transaction rows to pick up
  // the newer name/picture immediately. Tx's embedded `zapCounterparty`
  // is a snapshot from when the zap was attributed, so we layer a live
  // lookup on top by pubkey.
  const contactProfileByPubkey = useMemo(() => {
    const m = new Map<string, ZapCounterpartyInfo['profile']>();
    for (const c of contacts) {
      if (c.profile) {
        m.set(c.pubkey, {
          npub: c.profile.npub ?? '',
          name: c.profile.name ?? null,
          displayName: c.profile.displayName ?? null,
          picture: c.profile.picture ?? null,
          nip05: c.profile.nip05 ?? null,
        });
      }
    }
    return m;
  }, [contacts]);
  // Non-zap transactions (plain outgoing pays to a friend's lightning
  // address, incoming LNURL-pays) never get a zapCounterparty, so the
  // row's avatar falls back to the type icon even though the description
  // often *is* the counterparty's lud16. Build a side-index keyed on the
  // normalized lightning address so we can still surface the contact's
  // picture + name (#167).
  const contactByLud16 = useMemo(() => {
    const m = new Map<string, (typeof contacts)[number]>();
    for (const c of contacts) {
      const lud = c.profile?.lud16?.trim().toLowerCase();
      if (lud) m.set(lud, c);
    }
    return m;
  }, [contacts]);

  // Extract a lightning address from a tx description. NWC/LNbits ledger
  // entries frequently encode the counterparty as `user@host`, either as
  // the whole string or embedded in a longer memo like
  // "Zap from alice@primal.net - nice work!".
  const findLud16InDescription = (desc: string | undefined): string | null => {
    if (!desc) return null;
    const match = desc.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return match ? match[0].toLowerCase() : null;
  };
  // Incremental "infinite scroll" page counter. Page 1 renders the initial
  // window; onEndReached advances it, revealing another slice. The full tx
  // array already lives in memory (WalletContext owns it), so this is
  // in-memory windowing — we just avoid mounting hundreds of rows at once.
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [detail, setDetail] = useState<TransactionDetailData | null>(null);
  const [detailIconState, setDetailIconState] = useState<TransactionIconState | undefined>(
    undefined,
  );
  const [zapContact, setZapContact] = useState<CounterpartyContact | null>(null);

  // Subscribe to swapRecoveryService's attention set + claimed-hash cache
  // so rows re-render when a recovery pass / synchronous claim updates
  // either. Both are keyed by LN paymentHash (= sha256(preimage)), which
  // is what WalletTransaction rows carry, so matching is a direct .has()
  // per row. We bump a single counter on either change to force a render
  // — the actual lookups go through swapRecoveryService each time.
  const [swapStateTick, setSwapStateTick] = useState(0);
  useEffect(() => {
    const bump = () => setSwapStateTick((n) => n + 1);
    const unsubAttention = swapRecoveryService.subscribeAttention(bump);
    const unsubClaimed = swapRecoveryService.subscribeClaimed(bump);
    // Defensive bump: `loadClaimedHashes()` is kicked off eagerly at module
    // import, and recovery's `notifyAttention()` can fire before this
    // effect subscribes. Without an initial sync bump after subscribing,
    // either of those notifies would be missed and the list would render
    // with empty state until the *next* change. Bumping once forces a
    // fresh read through `getAttentionPaymentHashes()` /
    // `hasClaimedPaymentHash()` on the current values.
    bump();
    return () => {
      unsubAttention();
      unsubClaimed();
    };
  }, []);

  // Maps a row's live swap-recovery flags (Boltz row? in the attention set?
  // claim recorded?) onto the icon badge. The badge rules — including why a
  // recorded claim shows 'done' even when `settled_at` is missing (the #891
  // ambiguous-pay case) — live in `swapIconState`.
  const iconStateFor = (tx: WalletTransaction): TransactionIconState | undefined =>
    swapIconState(tx, {
      isBoltz: swapRecoveryService.isBoltzTransaction(tx),
      inAttention: Boolean(
        tx.paymentHash && swapRecoveryService.getAttentionPaymentHashes().has(tx.paymentHash),
      ),
      claimed: Boolean(tx.paymentHash && swapRecoveryService.hasClaimedPaymentHash(tx.paymentHash)),
    });

  // Counterparty preview — opened from TransactionDetailSheet → "view
  // profile". A quick-peek bottom sheet first; "View full profile"
  // inside drills into the ContactProfile route.
  const [sheetContact, setSheetContact] = useState<ContactProfileBodyData | null>(null);
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);

  // Collapse the list back to the first page when the active wallet
  // changes, but NOT on every transactions-array update. WalletContext
  // polls balances/transactions every few seconds and emits a new array
  // reference each time; keying the reset on `transactions` would fire the
  // effect on every poll and snap the user back to the top mid-scroll.
  // HomeScreen renders TransactionList without a `key` so it doesn't remount
  // on wallet switch — we reset explicitly here instead.
  useEffect(() => {
    setPagesLoaded(1);
  }, [activeWalletId]);

  const sorted = useMemo(() => sortTransactions(transactions), [transactions]);
  const visibleTransactions = useMemo(
    () => windowTransactions(sorted, pagesLoaded),
    [sorted, pagesLoaded],
  );
  const hasMore = hasMoreTransactions(transactions.length, pagesLoaded);

  // Flatten the visible window into day-header + tx rows for the FlatList.
  const rows: TxRow[] = useMemo(
    () => buildTransactionRows(visibleTransactions, formatDayHeader),
    [visibleTransactions],
  );

  // Reveal the next slice when the user scrolls near the bottom. `nextPage`
  // caps at the page that fully reveals the array, so repeated onEndReached
  // fires near the end don't churn state.
  const handleEndReached = useCallback(() => {
    setPagesLoaded((p) => nextPage(transactions.length, p));
  }, [transactions.length]);

  const renderRow = useCallback(
    ({ item: row }: ListRenderItemInfo<TxRow>) => {
      if (row.kind === 'header') {
        return <Text style={styles.dayHeader}>{row.label}</Text>;
      }
      const item = row.tx;
      const isIncoming = item.type === 'incoming';
      const amountSats = Math.abs(item.amount);
      // `??` (not `||`) so a `0` (epoch) timestamp counts as present; only
      // null/undefined means the tx has no settle/create time yet (pending).
      const ts = item.settled_at ?? item.created_at;
      const isPending = ts == null && !item.blockHeight;
      const zapCpRaw = item.zapCounterparty ?? undefined;
      // Prefer the live profile from contacts (which refreshes when the
      // profile cache updates) over the snapshot embedded in the tx.
      const liveProfile = zapCpRaw?.pubkey
        ? contactProfileByPubkey.get(zapCpRaw.pubkey)
        : undefined;
      const zapCp = zapCpRaw
        ? { ...zapCpRaw, profile: liveProfile ?? zapCpRaw.profile }
        : undefined;

      // For non-zap transactions, attempt to resolve the counterparty
      // via a lightning-address in the description. Keyed in
      // `contactByLud16` off the user's contacts, so it only promotes
      // people they follow (same source Friends tab reads from).
      const lud16FromDescription = !zapCp ? findLud16InDescription(item.description) : null;
      const descriptionContact = lud16FromDescription
        ? contactByLud16.get(lud16FromDescription)
        : undefined;

      // Primary label: counterparty name if attributed; else contact-by-
      // lud16 name; else URL host or raw description; else
      // "Received" / "Sent".
      let primary: string;
      let subtitle: string | null = null;
      if (isPending) {
        primary = t('transactionList.pending');
      } else if (zapCp) {
        primary = zapCounterpartyLabel(zapCp);
        subtitle = zapCp.comment?.trim() || null;
      } else if (descriptionContact) {
        primary =
          descriptionContact.profile?.displayName ??
          descriptionContact.profile?.name ??
          lud16FromDescription ??
          (isIncoming ? t('transactionList.received') : t('transactionList.sent'));
      } else if (item.description) {
        const split = splitDescription(item.description);
        primary = split.primary;
        subtitle = split.subtitle;
      } else {
        primary = isIncoming ? t('transactionList.received') : t('transactionList.sent');
      }

      // Explicit null check so a `0` (epoch) timestamp still formats instead of
      // rendering an empty string.
      const timeStr = ts != null ? formatTime(ts) : '';
      const counterpartyAvatar =
        zapCp?.profile?.picture ?? descriptionContact?.profile?.picture ?? null;
      const fiatStr = satsToFiatString(amountSats, btcPrice, currency);

      const rowIconState = iconStateFor(item);

      return (
        <TouchableOpacity
          style={[styles.item, isPending && styles.itemPending]}
          onPress={() => {
            setDetail(item as TransactionDetailData);
            setDetailIconState(rowIconState);
          }}
          accessibilityLabel={t('transactionList.openDetailsFor', { name: primary })}
        >
          <View style={styles.avatarWrap}>
            {counterpartyAvatar && isSupportedImageUrl(counterpartyAvatar) ? (
              <Image
                source={{ uri: counterpartyAvatar }}
                style={styles.avatar}
                cachePolicy="memory-disk"
                recyclingKey={counterpartyAvatar}
                autoplay={false}
                contentFit="cover"
              />
            ) : (
              <TransactionTypeIcon
                category={getTxCategory(item)}
                size={AVATAR_SIZE}
                state={rowIconState}
              />
            )}
          </View>

          <View style={styles.centerCol}>
            <View style={styles.centerLine}>
              <Text style={[styles.primary, isPending && styles.pendingText]} numberOfLines={1}>
                {primary}
              </Text>
              {timeStr ? <Text style={styles.time}> | {timeStr}</Text> : null}
            </View>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          <View style={styles.rightCol}>
            <View style={styles.amountsColumn}>
              <Text
                style={[
                  styles.amount,
                  isPending ? styles.pendingText : isIncoming ? styles.incoming : styles.outgoing,
                ]}
              >
                {amountSats.toLocaleString()} sats
              </Text>
              {fiatStr ? (
                <Text style={[styles.fiat, isPending && styles.pendingText]}>{fiatStr}</Text>
              ) : null}
            </View>
            <Text
              style={[
                styles.arrow,
                isPending ? styles.pendingText : isIncoming ? styles.incoming : styles.outgoing,
              ]}
            >
              {isIncoming ? '↓' : '↑'}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    // iconStateFor / findLud16InDescription are stable per-render closures;
    // the maps + price + styles cover all the data they read.
    [styles, contactProfileByPubkey, contactByLud16, btcPrice, currency, t],
  );

  const listFooter = hasMore ? (
    <View
      style={styles.footerSpinner}
      accessibilityLabel={t('transactionList.loadingMore')}
      testID="transaction-list-loading-more"
    >
      <ActivityIndicator size="small" color={colors.brandPink} />
    </View>
  ) : null;

  return (
    <>
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        // Swap-recovery attention/claimed flags live outside `data` (they're
        // read live from swapRecoveryService inside renderRow via
        // iconStateFor). FlatList only re-renders rows when data/renderItem/
        // extraData change by shallow compare, so thread the tick here to
        // force a badge refresh when only the swap state bumps.
        extraData={swapStateTick}
        refreshControl={refreshControl}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('transactionList.noTransactions')}</Text>
          </View>
        }
        // Match the first-page window so FlatList's initial render matches the
        // paging logic and can't drift if the page size is tuned (Copilot #940).
        initialNumToRender={INITIAL_PAGE_SIZE}
        windowSize={11}
        removeClippedSubviews
        testID="transaction-list"
      />
      <TransactionDetailSheet
        visible={detail !== null}
        tx={detail}
        iconState={detailIconState}
        onClose={() => setDetail(null)}
        onCounterpartyPress={(contact) => {
          setDetail(null);
          setSheetContact(contact);
          setProfileSheetVisible(true);
        }}
        onZapCounterparty={(contact) => {
          setDetail(null);
          setZapContact(contact);
        }}
        onMessageCounterparty={(contact) => {
          setDetail(null);
          navigation.navigate('Conversation', {
            pubkey: contact.pubkey,
            name: contact.name,
            picture: contact.picture,
            lightningAddress: contact.lightningAddress,
          });
        }}
      />
      <SendSheet
        visible={zapContact !== null}
        onClose={() => setZapContact(null)}
        initialAddress={zapContact?.lightningAddress ?? undefined}
        initialPicture={zapContact?.picture ?? undefined}
        recipientPubkey={zapContact?.pubkey ?? undefined}
        recipientName={zapContact?.name ?? undefined}
      />
      <ContactProfileSheet
        visible={profileSheetVisible}
        onClose={() => setProfileSheetVisible(false)}
        contact={sheetContact}
        onViewFullProfile={() => {
          if (!sheetContact) return;
          setProfileSheetVisible(false);
          navigation.navigate('ContactProfile', { contact: sheetContact });
        }}
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
        onZap={
          // Require both a pubkey AND a lightning address — SendSheet's
          // zap path needs a real pubkey to attach the zap receipt to
          // (NIP-57 verification fails on an empty-string sender).
          // Anonymous-zap counterparties (no pubkey) hide the icon
          // rather than silently mis-target.
          sheetContact?.pubkey && sheetContact.lightningAddress
            ? () => {
                const c = sheetContact;
                if (!c?.pubkey) return;
                setProfileSheetVisible(false);
                setZapContact({
                  pubkey: c.pubkey,
                  name: c.name,
                  picture: c.picture,
                  lightningAddress: c.lightningAddress,
                  banner: c.banner ?? null,
                  nip05: c.nip05 ?? null,
                  source: 'nostr',
                });
              }
            : undefined
        }
      />
    </>
  );
};

export default TransactionList;
