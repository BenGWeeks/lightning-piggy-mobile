import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';
import { useWallet } from '../contexts/WalletContext';
import TransactionDetailSheet, { TransactionDetailData } from './TransactionDetailSheet';
import type { ZapCounterpartyInfo } from '../types/wallet';

interface Transaction {
  type: string;
  amount: number;
  description?: string;
  created_at?: number | null;
  settled_at?: number | null;
  blockHeight?: number | null;
  txid?: string;
  swapId?: string;
  bolt11?: string;
  paymentHash?: string;
  zapCounterparty?: ZapCounterpartyInfo | null;
}

interface Props {
  transactions: Transaction[];
}

function zapCounterpartyLabel(sender: ZapCounterpartyInfo): string {
  if (sender.anonymous) return 'Anonymous';
  const profile = sender.profile;
  if (profile?.displayName) return profile.displayName;
  if (profile?.name) return profile.name;
  if (profile?.npub) return `${profile.npub.slice(0, 12)}…`;
  return 'Nostr user';
}

const INITIAL_COUNT = 20;

const TransactionList: React.FC<Props> = ({ transactions }) => {
  const { btcPrice, currency } = useWallet();
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<TransactionDetailData | null>(null);

  // Reset when transaction list changes (wallet swipe)
  React.useEffect(() => setShowAll(false), [transactions]);

  if (transactions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No transactions yet</Text>
      </View>
    );
  }

  // Sort: pending (no timestamp) first, then newest first
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

  return (
    <View style={styles.list}>
      {visibleTransactions.map((item, index) => {
        const isIncoming = item.type === 'incoming';
        const amountSats = Math.abs(item.amount);
        const date = item.settled_at || item.created_at;
        const isPending = !date && !item.blockHeight;
        const dateStr = date
          ? new Date(date * 1000).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : item.blockHeight
            ? `Block ${item.blockHeight.toLocaleString()}`
            : '';
        const zapCounterparty = item.zapCounterparty ?? undefined;
        const label = isPending
          ? 'Pending'
          : zapCounterparty
            ? `${isIncoming ? 'Received from' : 'Sent to'} ${zapCounterpartyLabel(zapCounterparty)}`
            : item.description || (isIncoming ? 'Received' : 'Sent');
        const fiatStr = satsToFiatString(amountSats, btcPrice, currency);
        const counterpartyAvatar = zapCounterparty?.profile?.picture ?? null;

        return (
          <TouchableOpacity
            key={index}
            style={[styles.item, isPending && styles.itemPending]}
            onPress={() => setDetail(item as TransactionDetailData)}
            accessibilityLabel={`Open details for ${label}`}
          >
            <View style={styles.itemLeft}>
              {counterpartyAvatar ? (
                <Image
                  source={{ uri: counterpartyAvatar }}
                  style={styles.itemAvatar}
                  cachePolicy="disk"
                  contentFit="cover"
                />
              ) : (
                <Text style={[styles.itemIcon, isPending && styles.pendingText]}>
                  {isIncoming ? '↓' : '↑'}
                </Text>
              )}
              <View style={styles.itemDescriptionContainer}>
                <Text
                  style={[styles.itemDescription, isPending && styles.pendingText]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
                <Text style={styles.itemDate}>{dateStr}</Text>
              </View>
            </View>
            <View style={styles.itemRight}>
              <Text
                style={[
                  styles.itemAmount,
                  isPending ? styles.pendingText : isIncoming ? styles.incoming : styles.outgoing,
                ]}
              >
                {isIncoming ? '+' : '-'}
                {amountSats.toLocaleString()} sats
              </Text>
              {fiatStr ? (
                <Text style={[styles.itemFiat, isPending && styles.pendingText]}>{fiatStr}</Text>
              ) : null}
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
      />
    </View>
  );
};

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
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  itemIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.brandPink,
    width: 32,
    textAlign: 'center',
  },
  itemAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
  },
  itemDescriptionContainer: {
    flex: 1,
  },
  itemDescription: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
  },
  itemDate: {
    fontSize: 12,
    color: colors.textSupplementary,
    marginTop: 2,
  },
  itemRight: {
    alignItems: 'flex-end',
  },
  itemAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  itemFiat: {
    fontSize: 12,
    color: colors.textSupplementary,
    marginTop: 2,
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
