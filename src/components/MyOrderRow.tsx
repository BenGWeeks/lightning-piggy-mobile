import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useThemeColors } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import { createMyOrderRowStyles } from '../styles/MyOrderRow.styles';
import { shortOrderId } from '../utils/marketOrder';
import type { BuyerOrderEntry } from '../utils/orderThreads';
import OrderStatusChip from './OrderStatusChip';

interface Props {
  entry: BuyerOrderEntry;
  /** "Mug × 2, Hat × 1". */
  itemsSummary: string;
  /** Opens the seller conversation at this order. */
  onPress: (entry: BuyerOrderEntry, sellerName: string, sellerPicture: string | null) => void;
}

/** One order in My orders: seller, items, total, date and status chip. */
function MyOrderRow({ entry, itemsSummary, onPress }: Props): React.ReactElement {
  const colors = useThemeColors();
  const { t, formatLocale } = useLocale();
  const styles = useMemo(() => createMyOrderRowStyles(colors), [colors]);
  const profile = usePubkeyProfile(entry.sellerPubkey);
  const [imageFailed, setImageFailed] = useState(false);
  const sellerName = profile.name || `${entry.sellerPubkey.slice(0, 8)}…`;
  const picture = profile.picture ?? null;
  const id8 = shortOrderId(entry.orderId);
  const amount = entry.order.amountSats;
  const date = new Date(entry.placedAt * 1000).toLocaleDateString(formatLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(entry, sellerName, picture)}
      accessibilityRole="button"
      accessibilityLabel={t('myOrders.rowA11y', {
        seller: sellerName,
        items: itemsSummary,
        status: t(`orderStatus.${entry.status}`),
      })}
      testID={`my-order-row-${id8}`}
    >
      {picture && !imageFailed ? (
        <Image
          source={{ uri: picture }}
          style={styles.avatar}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={picture}
          autoplay={false}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarLetter}>{sellerName.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={styles.seller} numberOfLines={1}>
            {sellerName}
          </Text>
          {amount !== undefined ? (
            <Text style={styles.total}>
              {t('market.sats', { amount: amount.toLocaleString(formatLocale) })}
            </Text>
          ) : null}
        </View>
        <Text style={styles.items} numberOfLines={2}>
          {itemsSummary}
        </Text>
        <View style={styles.bottomLine}>
          <OrderStatusChip status={entry.status} testID={`my-order-status-${id8}`} />
          <Text style={styles.date}>{date}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(MyOrderRow);
