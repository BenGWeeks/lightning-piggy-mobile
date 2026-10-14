import React, { useCallback, useMemo } from 'react';
import { FlatList, View, Text } from 'react-native';
import { ReceiptText } from 'lucide-react-native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useBuyerOrders } from '../hooks/useBuyerOrders';
import MarketSellerHeader from '../components/MarketSellerHeader';
import MyOrderRow from '../components/MyOrderRow';
import BrandedSpinner from '../components/BrandedSpinner';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import { createMarketMyOrdersScreenStyles } from '../styles/MarketMyOrdersScreen.styles';
import type { BuyerOrderEntry } from '../utils/orderThreads';
import type { ExploreNavigation, RootStackParamList } from '../navigation/types';

type Navigation = CompositeNavigationProp<
  ExploreNavigation,
  NativeStackNavigationProp<RootStackParamList>
>;

interface Props {
  navigation: Navigation;
}

/** "Mug × 2" from the titles recorded at checkout, else the listing id. */
function itemsSummary(entry: BuyerOrderEntry, titles: Record<string, string> | undefined): string {
  return entry.order.items
    .map(
      (item) =>
        `${titles?.[item.ref] ?? item.ref.split(':').slice(2).join(':')} × ${item.quantity}`,
    )
    .join(', ');
}

/**
 * Buyer's My orders: every Gamma order I placed, newest first, with where it
 * stands (Awaiting invoice / Pay now / Paid / Shipped / Completed). Read from
 * the encrypted DM store — no relay subscription. A row opens the seller's
 * NIP-17 chat at the order (or at its invoice when there's one to pay).
 */
const MarketMyOrdersScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sellerStyles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const styles = useMemo(() => createMarketMyOrdersScreenStyles(colors), [colors]);
  const { entries, titles, loading } = useBuyerOrders();

  const openOrder = useCallback(
    (entry: BuyerOrderEntry, sellerName: string, sellerPicture: string | null) => {
      navigation.navigate('Conversation', {
        pubkey: entry.sellerPubkey,
        name: sellerName,
        picture: sellerPicture,
        // Gamma orders only ever ride NIP-17 gift wraps.
        protocol: 'nip17',
        ...(entry.jumpToRowId ? { jumpToMessage: entry.jumpToRowId } : {}),
      });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: BuyerOrderEntry }) => (
      <MyOrderRow
        entry={item}
        itemsSummary={itemsSummary(item, titles[item.orderId])}
        onPress={openOrder}
      />
    ),
    [titles, openOrder],
  );

  return (
    <View style={sellerStyles.container} testID="my-orders-screen">
      <MarketSellerHeader
        title={t('myOrders.title')}
        backLabel={t('market.sell.back')}
        onBack={() => navigation.goBack()}
        styles={sellerStyles}
        testID="my-orders-back"
      />
      {loading && entries.length === 0 ? (
        <View style={styles.empty}>
          <BrandedSpinner />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={entries}
          keyExtractor={(entry) => `${entry.sellerPubkey}:${entry.orderId}`}
          renderItem={renderItem}
          testID="my-orders-list"
          ListEmptyComponent={
            <View style={styles.empty} testID="my-orders-empty">
              <ReceiptText size={36} color={colors.textSupplementary} strokeWidth={1.75} />
              <Text style={styles.emptyText}>{t('myOrders.empty')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

export default MarketMyOrdersScreen;
