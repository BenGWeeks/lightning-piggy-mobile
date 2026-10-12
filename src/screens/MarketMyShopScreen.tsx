import MerchantIdentity from '../components/MerchantIdentity';
import CollectionManager from '../components/CollectionManager';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { Plus, Settings, Store } from 'lucide-react-native';
import type { Event } from 'nostr-tools';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useSellerShop } from '../hooks/useSellerShop';
import { useSellerActions } from '../hooks/useSellerActions';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import MarketSellerHeader from '../components/MarketSellerHeader';
import SellerListingRow from '../components/SellerListingRow';
import NostrLoginSheet from '../components/NostrLoginSheet';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import { parseListingDraft, type ListingDraft } from '../utils/marketSellerEvents';
import { parseMarketListing } from '../utils/marketListings';
import type { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

interface Row {
  event: Event;
  draft: ListingDraft;
}

/** "My shop": the user's shop card, "Sell an item", and their listings. */
const MarketMyShopScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const { pubkey, snapshot, status, refresh, canPublish } = useSellerShop();
  const { deleteListing, busy } = useSellerActions(snapshot);
  const [loginVisible, setLoginVisible] = useState(false);

  // Re-use a row (and so its parsed draft) while the event is unchanged, so
  // the memoised rows skip re-rendering on unrelated store updates.
  const rowCache = useRef(new Map<string, Row>());
  const rows = useMemo<Row[]>(() => {
    const next = new Map<string, Row>();
    const out = snapshot.listings.map((event) => {
      const row = rowCache.current.get(event.id) ?? { event, draft: parseListingDraft(event) };
      next.set(event.id, row);
      return row;
    });
    rowCache.current = next;
    return out;
  }, [snapshot.listings]);

  const onEdit = useCallback(
    (dTag: string) => navigation.navigate('MarketListingEditor', { dTag }),
    [navigation],
  );
  const onPreview = useCallback(
    (event: Event) => {
      const product = parseMarketListing(event);
      if (product) navigation.navigate('MarketProductDetail', { productId: product.id, product });
    },
    [navigation],
  );
  const onDelete = useCallback(
    (event: Event) => {
      // One change at a time: two quick deletes would both rebuild the shop
      // from the same snapshot.
      if (busy) return;
      const title = parseListingDraft(event).title;
      Alert.alert(t('market.sell.deleteTitle'), t('market.sell.deleteBody', { title }), [
        { text: t('market.sell.cancel'), style: 'cancel' },
        {
          text: t('market.sell.delete'),
          style: 'destructive',
          onPress: () => {
            deleteListing(event)
              .then(() => Toast.show({ type: 'success', text1: t('market.sell.deleted') }))
              .catch((e: Error) =>
                Toast.show({
                  type: 'error',
                  text1: t('market.sell.deleteFailed'),
                  text2: e.message,
                }),
              );
          },
        },
      ]);
    },
    [deleteListing, busy, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <SellerListingRow
        event={item.event}
        draft={item.draft}
        styles={styles}
        onEdit={onEdit}
        onPreview={onPreview}
        onDelete={onDelete}
      />
    ),
    [styles, onEdit, onPreview, onDelete],
  );
  const renderSeparator = useCallback(() => <View style={styles.separator} />, [styles]);

  const header = (
    <MarketSellerHeader
      title={t('market.sell.myShop')}
      backLabel={t('market.sell.back')}
      onBack={() => navigation.goBack()}
      styles={styles}
      testID="my-shop-back"
    />
  );

  if (!pubkey || !canPublish) {
    return (
      <View style={styles.container} testID="my-shop-screen">
        {header}
        <View style={styles.centered}>
          <Store size={40} color={colors.brandPink} strokeWidth={2} />
          <Text style={styles.cardTitle}>{t('market.sell.signInTitle')}</Text>
          <Text style={[styles.cardBody, styles.centerText]}>
            {pubkey ? t('market.sell.cannotPublish') : t('market.sell.signInBody')}
          </Text>
          {!pubkey ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setLoginVisible(true)}
              accessibilityLabel={t('market.sell.signIn')}
              testID="my-shop-sign-in"
            >
              <Text style={styles.primaryButtonText}>{t('market.sell.signIn')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <NostrLoginSheet visible={loginVisible} onClose={() => setLoginVisible(false)} />
      </View>
    );
  }

  const listHeader = (
    <View style={styles.listHeader}>
      <View style={styles.card} testID="my-shop-card">
        <MerchantIdentity />
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('MarketShopSettings')}
          testID="my-shop-edit"
          accessibilityLabel={t('market.sell.editShop')}
        >
          <Settings size={22} color={colors.brandPink} />
          <Text style={styles.secondaryButtonText}>{t('market.sell.editShop')}</Text>
        </TouchableOpacity>
      </View>
      <CollectionManager snapshot={snapshot} />
      {status === 'error' ? (
        <TouchableOpacity
          onPress={refresh}
          accessibilityLabel={t('market.sell.retry')}
          testID="my-shop-retry"
        >
          <Text style={styles.errorText}>{t('market.sell.loadError')}</Text>
        </TouchableOpacity>
      ) : null}
      {canPublish ? (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('MarketListingEditor')}
          accessibilityLabel={t('market.sell.sellItem')}
          testID="my-shop-sell-item"
        >
          <Plus size={18} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.primaryButtonText}>{t('market.sell.sellItem')}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.sectionTitle}>{t('market.sell.yourListings')}</Text>
    </View>
  );

  return (
    <View style={styles.container} testID="my-shop-screen">
      {header}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.event.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          status === 'loading' ? null : (
            <Text style={[styles.muted, styles.emptyText]} testID="my-shop-no-listings">
              {t('market.sell.noListings')}
            </Text>
          )
        }
        ItemSeparatorComponent={renderSeparator}
        contentContainerStyle={styles.listContent}
        style={styles.flex1}
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading'}
            onRefresh={refresh}
            tintColor={colors.brandPink}
          />
        }
        initialNumToRender={8}
        windowSize={7}
      />
    </View>
  );
};

export default MarketMyShopScreen;
