import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import TransactionDetailSheet, {
  TransactionDetailData,
  CounterpartyContact,
} from './TransactionDetailSheet';
import ContactProfileSheet from './ContactProfileSheet';
import SendSheet from './SendSheet';
import TransactionTypeIcon from './TransactionTypeIcon';
import { getTxCategory } from '../utils/txCategory';
import type { WalletTransaction, ZapCounterpartyInfo } from '../types/wallet';
import type { RootStackParamList } from '../navigation/types';

interface Props {
  transactions: WalletTransaction[];
}

function zapCounterpartyLabel(cp: ZapCounterpartyInfo): string {
  if (cp.anonymous) return 'Anonymous';
  const profile = cp.profile;
  if (profile?.displayName) return profile.displayName;
  if (profile?.name) return profile.name;
  if (profile?.npub) return `${profile.npub.slice(0, 12)}…`;
  return 'Nostr user';
}

/** Parse URL-shaped descriptions into `{ primary, subtitle }` so a row like
 * "https://memestore.satmo-dev.xyz - Order #4497" renders with the domain
 * prominent and the full URL/memo below, matching Primal's treatment. */
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
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
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

const INITIAL_COUNT = 20;

type ItemRow = { kind: 'tx'; tx: WalletTransaction; key: string };
type HeaderRow = { kind: 'header'; label: string; key: string };
type Row = ItemRow | HeaderRow;

/** Build a deterministic key for a transaction row. Prefers settled-payment
 * identifiers, falling back to on-chain txid, then bolt11, then a composite
 * of the stable shape fields so pending rows still get distinct keys.
 * Self-payments produce two entries with the same paymentHash / bolt11
 * (incoming + outgoing leg), so always include `tx.type` to disambiguate. */
function txKey(tx: WalletTransaction, fallbackIndex: number): string {
  if (tx.paymentHash) return `ph:${tx.type}:${tx.paymentHash}`;
  if (tx.txid) return `tx:${tx.type}:${tx.txid}`;
  if (tx.bolt11) return `b11:${tx.type}:${tx.bolt11}`;
  return `fb:${tx.type}:${tx.created_at ?? tx.settled_at ?? 'pending'}:${tx.amount}:${fallbackIndex}`;
}

const TransactionList: React.FC<Props> = ({ transactions }) => {
  const { btcPrice, currency } = useWallet();
  const { contacts } = useNostr();
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
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<TransactionDetailData | null>(null);
  const [profileContact, setProfileContact] = useState<CounterpartyContact | null>(null);
  const [zapContact, setZapContact] = useState<CounterpartyContact | null>(null);

  React.useEffect(() => setShowAll(false), [transactions]);

  if (transactions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No transactions yet</Text>
      </View>
    );
  }

  // Sort: pending (no timestamp) first, then newest first.
  const sorted = [...transactions].sort((a, b) => {
    const aTime = a.settled_at || a.created_at;
    const bTime = b.settled_at || b.created_at;
    if (!aTime && !bTime) return 0;
    if (!aTime) return -1;
    if (!bTime) return 1;
    return bTime - aTime;
  });
  const visibleTransactions = showAll ? sorted : sorted.slice(0, INITIAL_COUNT);
  const hasMore = transactions.length > INITIAL_COUNT;

  // Flatten into a mixed list of day headers + rows. Pending entries (no
  // timestamp) get a "Pending" header so they still group visually.
  const rows: Row[] = [];
  let currentDayKey: string | null = null;
  visibleTransactions.forEach((tx, fallbackIndex) => {
    const ts = tx.settled_at || tx.created_at;
    const dayKey = ts ? new Date(ts * 1000).toDateString() : '__pending__';
    if (dayKey !== currentDayKey) {
      rows.push({
        kind: 'header',
        label: ts ? formatDayHeader(ts) : 'Pending',
        key: `h:${dayKey}`,
      });
      currentDayKey = dayKey;
    }
    rows.push({ kind: 'tx', tx, key: txKey(tx, fallbackIndex) });
  });

  return (
    <View style={styles.list}>
      {rows.map((row) => {
        if (row.kind === 'header') {
          return (
            <Text key={row.key} style={styles.dayHeader}>
              {row.label}
            </Text>
          );
        }
        const item = row.tx;
        const isIncoming = item.type === 'incoming';
        const amountSats = Math.abs(item.amount);
        const ts = item.settled_at || item.created_at;
        const isPending = !ts && !item.blockHeight;
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
          primary = 'Pending';
        } else if (zapCp) {
          primary = zapCounterpartyLabel(zapCp);
          subtitle = zapCp.comment?.trim() || null;
        } else if (descriptionContact) {
          primary =
            descriptionContact.profile?.displayName ??
            descriptionContact.profile?.name ??
            lud16FromDescription ??
            (isIncoming ? 'Received' : 'Sent');
        } else if (item.description) {
          const split = splitDescription(item.description);
          primary = split.primary;
          subtitle = split.subtitle;
        } else {
          primary = isIncoming ? 'Received' : 'Sent';
        }

        const timeStr = ts ? formatTime(ts) : '';
        const counterpartyAvatar =
          zapCp?.profile?.picture ?? descriptionContact?.profile?.picture ?? null;
        const fiatStr = satsToFiatString(amountSats, btcPrice, currency);

        return (
          <TouchableOpacity
            key={row.key}
            style={[styles.item, isPending && styles.itemPending]}
            onPress={() => setDetail(item as TransactionDetailData)}
            accessibilityLabel={`Open details for ${primary}`}
          >
            <View style={styles.avatarWrap}>
              {counterpartyAvatar ? (
                <Image
                  source={{ uri: counterpartyAvatar }}
                  style={styles.avatar}
                  cachePolicy="disk"
                  contentFit="cover"
                />
              ) : (
                <TransactionTypeIcon category={getTxCategory(item)} size={AVATAR_SIZE} />
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
      })}
      {hasMore && !showAll && (
        <TouchableOpacity style={styles.showMore} onPress={() => setShowAll(true)}>
          <Text style={styles.showMoreText}>Show all {transactions.length} transactions</Text>
        </TouchableOpacity>
      )}
      <TransactionDetailSheet
        visible={detail !== null}
        tx={detail}
        onClose={() => setDetail(null)}
        onCounterpartyPress={(contact) => {
          setDetail(null);
          setProfileContact(contact);
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
      <ContactProfileSheet
        visible={profileContact !== null}
        onClose={() => setProfileContact(null)}
        contact={profileContact}
        onMessage={
          profileContact
            ? () => {
                const c = profileContact;
                setProfileContact(null);
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
          profileContact?.lightningAddress
            ? () => {
                const c = profileContact;
                setProfileContact(null);
                setZapContact(c);
              }
            : undefined
        }
      />
      <SendSheet
        visible={zapContact !== null}
        onClose={() => setZapContact(null)}
        initialAddress={zapContact?.lightningAddress ?? undefined}
        initialPicture={zapContact?.picture ?? undefined}
        recipientPubkey={zapContact?.pubkey ?? undefined}
        recipientName={zapContact?.name ?? undefined}
      />
    </View>
  );
};

const AVATAR_SIZE = 40;

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSupplementary,
    fontSize: 16,
  },
  dayHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSupplementary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.background,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.brandPinkLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderIcon: {
    fontSize: 20,
    color: colors.brandPink,
  },
  centerCol: {
    flex: 1,
    minWidth: 0,
  },
  centerLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  primary: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textHeader,
    flexShrink: 1,
  },
  time: {
    fontSize: 12,
    color: colors.textSupplementary,
    marginLeft: 4,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSupplementary,
    marginTop: 2,
  },
  rightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  amountsColumn: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 15,
    fontWeight: '700',
  },
  arrow: {
    fontSize: 22,
    fontWeight: '700',
  },
  fiat: {
    fontSize: 11,
    color: colors.textSupplementary,
    marginTop: 1,
  },
  showMore: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  showMoreText: {
    color: colors.brandPink,
    fontSize: 14,
    fontWeight: '600',
  },
  incoming: {
    color: colors.green,
  },
  outgoing: {
    color: colors.red,
  },
  itemPending: {
    opacity: 0.5,
  },
  pendingText: {
    color: colors.textSupplementary,
  },
});

export default TransactionList;
