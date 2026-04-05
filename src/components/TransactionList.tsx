import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ArrowDown, ArrowUp } from 'lucide-react-native';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';
import { useWallet } from '../contexts/WalletContext';
import type { Nip47Transaction } from '../services/nwcService';

interface Props {
  transactions: Nip47Transaction[];
  onTransactionPress?: (tx: Nip47Transaction) => void;
}

const TransactionList: React.FC<Props> = ({ transactions, onTransactionPress }) => {
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
          <TouchableOpacity
            key={item.payment_hash || `tx-${index}`}
            style={styles.item}
            onPress={() => onTransactionPress?.(item)}
            accessibilityLabel={`${isIncoming ? 'Received' : 'Sent'} ${amountSats} sats`}
            testID={`transaction-row-${index}`}
          >
            <View style={styles.itemLeft}>
              {isIncoming ? (
                <ArrowDown size={18} color={colors.brandPink} />
              ) : (
                <ArrowUp size={18} color={colors.brandPink} />
              )}
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
          </TouchableOpacity>
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
