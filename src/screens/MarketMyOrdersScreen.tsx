import OrderPaymentActions from '../components/OrderPaymentActions';
import SendSheet from '../components/SendSheet';
import type { RouteProp } from '@react-navigation/native';
import type { ExploreStackParamList } from '../navigation/types';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, View, Text } from 'react-native';
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
  route: RouteProp<ExploreStackParamList, 'MarketMyOrders'>;
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
 * the encrypted DM store — no relay subscription. A row opens a market
 * detail with its validated payment action, without entering chat.
 */
const MarketMyOrdersScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sellerStyles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const styles = useMemo(() => createMarketMyOrdersScreenStyles(colors), [colors]);
  const [invoiceToPay, setInvoiceToPay] = useState<string | null>(null);
  const { entries, titles, loading } = useBuyerOrders();

  const openOrder = useCallback(
    (entry: BuyerOrderEntry) => {
      navigation.push('MarketMyOrders', {
        orderId: entry.orderId,
        sellerPubkey: entry.sellerPubkey,
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

  const selected = entries.find(
    (entry) =>
      entry.orderId === route.params?.orderId && entry.sellerPubkey === route.params?.sellerPubkey,
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
      ) : route.params?.orderId ? (
        <ScrollView contentContainerStyle={styles.listContent}>
          {selected ? (
            <>
              <Text style={styles.emptyText}>
                {itemsSummary(selected, titles[selected.orderId])}
              </Text>
              <Text style={styles.emptyText}>{t(`orderStatus.${selected.status}`)}</Text>
              {selected.paymentRequest ? (
                <OrderPaymentActions
                  order={selected.paymentRequest}
                  expectedAmountSats={selected.order.amountSats}
                  fromMe={false}
                  onPayInvoice={setInvoiceToPay}
                  testIdPrefix="my-order"
                  id={selected.orderId}
                />
              ) : null}
            </>
          ) : (
            <Text style={styles.emptyText}>{t('myOrders.empty')}</Text>
          )}
        </ScrollView>
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
      <SendSheet
        visible={invoiceToPay !== null}
        onClose={() => setInvoiceToPay(null)}
        initialAddress={invoiceToPay ?? undefined}
      />
    </View>
  );
};

export default MarketMyOrdersScreen;
