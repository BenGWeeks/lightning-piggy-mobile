import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';
import { useWallet } from '../contexts/WalletContext';

interface Transaction {
  type: string;
  amount: number;
  description?: string;
  created_at?: number;
  settled_at?: number;
}

interface Props {
  transactions: Transaction[];
}

const TransactionList: React.FC<Props> = ({ transactions }) => {
  const { btcPrice, currency } = useWallet();

  if (transactions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No transactions yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {transactions.map((item, index) => {
        const isIncoming = item.type === 'incoming';
        const amountSats = Math.abs(item.amount);
        const date = item.settled_at || item.created_at;
        const dateStr = date ? new Date(date * 1000).toLocaleDateString() : '';
        const fiatStr = satsToFiatString(amountSats, btcPrice, currency);

        return (
          <View key={index} style={styles.item}>
            <View style={styles.itemLeft}>
              <Text style={styles.itemIcon}>{isIncoming ? '↓' : '↑'}</Text>
              <View style={styles.itemDescriptionContainer}>
                <Text style={styles.itemDescription} numberOfLines={1}>
                  {item.description || (isIncoming ? 'Received' : 'Sent')}
                </Text>
                <Text style={styles.itemDate}>{dateStr}</Text>
              </View>
            </View>
            <View style={styles.itemRight}>
              <Text style={[styles.itemAmount, isIncoming ? styles.incoming : styles.outgoing]}>
                {isIncoming ? '+' : '-'}
                {amountSats.toLocaleString()} sats
              </Text>
              {fiatStr ? <Text style={styles.itemFiat}>{fiatStr}</Text> : null}
            </View>
          </View>
        );
      })}
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
  incoming: {
    color: colors.green,
  },
  outgoing: {
    color: colors.red,
  },
});

export default TransactionList;
