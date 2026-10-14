import React, { useCallback, useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { ShoppingBag } from 'lucide-react-native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import BrandedSpinner from '../components/BrandedSpinner';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useSellerShop } from '../hooks/useSellerShop';
import { useShopOrders } from '../hooks/useShopOrders';
import { useBuyerProfiles } from '../hooks/useBuyerProfiles';
import MarketSellerHeader from '../components/MarketSellerHeader';
import ShopOrderRow from '../components/ShopOrderRow';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import { createMarketShopOrdersStyles } from '../styles/MarketShopOrders.styles';
import { merchantLabel } from '../utils/marketMerchants';
import { listingTitleMap, type ShopOrder } from '../utils/shopOrders';
import type { ExploreNavigation, RootStackParamList } from '../navigation/types';

// Conversation lives on the root stack, not the Explore stack.
type OrdersNavigation = CompositeNavigationProp<
  ExploreNavigation,
  NativeStackNavigationProp<RootStackParamList>
>;

interface Props {
  navigation: OrdersNavigation;
}

const orderKey = (order: ShopOrder) => order.key;

/** Incoming Gamma orders for the seller's own listings (#1534), read from
 * the encrypted DM store. Tapping one opens that buyer's NIP-17
 * conversation at the order message. */
const MarketShopOrdersScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const orderStyles = useMemo(() => createMarketShopOrdersStyles(colors), [colors]);
  const { snapshot } = useSellerShop();
  const titles = useMemo(() => listingTitleMap(snapshot.listings), [snapshot.listings]);
  const { orders } = useShopOrders(titles);
  const buyersKey = useMemo(
    () => [...new Set((orders ?? []).map((o) => o.buyer))].sort().join(','),
    [orders],
  );
  const profiles = useBuyerProfiles(buyersKey);

  const onOpen = useCallback(
    (order: ShopOrder) => {
      const profile = profiles.get(order.buyer);
      navigation.navigate('Conversation', {
        pubkey: order.buyer,
        name: merchantLabel(order.buyer, profile),
        picture: profile?.picture ?? null,
        protocol: 'nip17',
        jumpToMessage: order.eventId,
      });
    },
    [navigation, profiles],
  );

  const renderItem = useCallback(
    ({ item }: { item: ShopOrder }) => {
      const profile = profiles.get(item.buyer);
      return (
        <ShopOrderRow
          order={item}
          buyerName={merchantLabel(item.buyer, profile)}
          buyerPicture={profile?.picture ?? undefined}
          styles={orderStyles}
          onPress={onOpen}
        />
      );
    },
    [profiles, orderStyles, onOpen],
  );
  const renderSeparator = useCallback(() => <View style={styles.separator} />, [styles]);

  return (
    <View style={styles.container} testID="shop-orders-screen">
      <MarketSellerHeader
        title={t('market.sell.hub.orders')}
        backLabel={t('market.sell.back')}
        onBack={() => navigation.goBack()}
        styles={styles}
        testID="shop-orders-back"
      />
      {!orders ? (
        <View style={styles.centered}>
          <BrandedSpinner />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={orderKey}
          renderItem={renderItem}
          ItemSeparatorComponent={renderSeparator}
          ListHeaderComponent={
            orders.length > 0 ? (
              <View style={orderStyles.listHeader}>
                <Text style={styles.hint}>{t('market.sell.orders.hint')}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={orderStyles.empty} testID="shop-orders-empty">
              <ShoppingBag size={40} color={colors.brandPink} strokeWidth={2} />
              <Text style={orderStyles.emptyTitle}>{t('market.sell.hub.noOrders')}</Text>
              <Text style={orderStyles.emptyBody}>{t('market.sell.orders.emptyBody')}</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          style={styles.flex1}
          initialNumToRender={10}
          windowSize={7}
          testID="shop-order-list"
        />
      )}
    </View>
  );
};

export default MarketShopOrdersScreen;
