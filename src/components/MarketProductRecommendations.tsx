import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import {
  StackActions,
  useNavigation,
  useRoute,
  type CompositeNavigationProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { sellerOf, type MarketProduct } from '../data/marketProducts';
import { loadedMarketSnapshots } from '../services/marketStorage';
import { PREFERRED_SELLERS_ACCOUNT } from '../services/marketPreferredSellers';
import { useSellerProducts } from '../hooks/useSellerProducts';
import { vendorNostrPubkey } from '../utils/marketVendors';
import {
  mergeCatalogue,
  productPageAction,
  recommendationCardId,
  recommendListings,
  sellerListings,
  shouldShowRecommendations,
} from '../utils/marketRecommendations';
import {
  createMarketProductRecommendationsStyles,
  RECO_CARD_GAP,
  RECO_CARD_WIDTH,
  type MarketProductRecommendationsStyles,
} from '../styles/MarketProductRecommendations.styles';
import MarketProductCard from './MarketProductCard';
import type { ExploreNavigation, RootStackParamList } from '../navigation/types';

type Navigation = CompositeNavigationProp<
  ExploreNavigation,
  NativeStackNavigationProp<RootStackParamList>
>;

interface Props {
  /** The product the page shows. */
  product: MarketProduct;
  /** The seller's display name as the page resolved it. */
  sellerName: string;
}

/** Long enough for the push animation to finish, so the carousels never
 * compete with the page's first paint or its transition. */
const DEFER_MS = 350;
const ITEM_STRIDE = RECO_CARD_WIDTH + RECO_CARD_GAP;

/**
 * "More from <seller>" and "You might like" rails at the bottom of a Market
 * product page (#1542). Both draw on the Market catalogue already loaded in
 * memory; only a seller missing from it costs one bounded listings query.
 * Mounted after first paint so the product itself renders first.
 */
const MarketProductRecommendations: React.FC<Props> = (props) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setReady(true), DEFER_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return ready ? <RecommendationRails {...props} /> : null;
};

const RecommendationRails: React.FC<Props> = ({ product, sellerName }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketProductRecommendationsStyles(colors), [colors]);
  const navigation = useNavigation<Navigation>();
  const route = useRoute();
  const { pubkey } = useNostr();
  const { contacts } = useNostrContacts();

  // A curated product has no listing; its vendor's npub still names the seller.
  const sellerPubkey = useMemo(() => {
    if (product.listing) return product.listing.event.pubkey;
    const vendor = sellerOf(product);
    return vendor ? vendorNostrPubkey(vendor) : null;
  }, [product]);

  // Snapshot of what the Market has already loaded: the preferred-sellers
  // catalogue plus this account's friends catalogue.
  const catalogue = useMemo(
    () =>
      mergeCatalogue(
        loadedMarketSnapshots(
          pubkey ? [PREFERRED_SELLERS_ACCOUNT, pubkey] : [PREFERRED_SELLERS_ACCOUNT],
        ).map(({ account, products }) => ({
          mode: account === PREFERRED_SELLERS_ACCOUNT ? 'preferred' : 'wotFriends',
          products,
        })),
      ),
    // Re-read per product page; the catalogue isn't live-updated mid-page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkey, product.id],
  );
  // Present in a loaded snapshot = that seller was queried; none of theirs
  // there means we've never fetched them, so ask once (bounded, abortable).
  const sellerLoaded = useMemo(
    () => !!sellerPubkey && catalogue.modeBySeller.has(sellerPubkey),
    [catalogue, sellerPubkey],
  );
  const fallback = useSellerProducts(sellerPubkey, !sellerLoaded, 0, sellerName);
  const moreFromSeller = useMemo(
    () =>
      sellerListings(sellerLoaded ? catalogue.products : fallback.products, sellerPubkey, product),
    [sellerLoaded, catalogue, fallback.products, sellerPubkey, product],
  );

  const followed = useMemo(
    () => new Set(contacts.map((contact) => contact.pubkey.toLowerCase())),
    [contacts],
  );
  const youMightLike = useMemo(
    () =>
      recommendListings(catalogue.products, product, moreFromSeller, {
        followed,
        viewer: pubkey,
        // TODO(#1542): pass `liked` from the NIP-25 Market likes helper once
        // feat/market-like-share lands on main.
      }),
    [catalogue, product, moreFromSeller, followed, pubkey],
  );

  const openProduct = useCallback(
    (next: MarketProduct) => {
      const params = { productId: next.id, product: next };
      const routeNames = navigation.getState()?.routes.map((r) => r.name) ?? [];
      navigation.dispatch(
        productPageAction(routeNames, route.name) === 'replace'
          ? StackActions.replace(route.name, params)
          : StackActions.push(route.name, params),
      );
    },
    [navigation, route.name],
  );

  const onSeeAll = useCallback(() => {
    if (!sellerPubkey) return;
    const mode = catalogue.modeBySeller.get(sellerPubkey);
    if (!mode) {
      // Not in any Market catalogue, so a filtered grid would come up empty:
      // their profile's Shop tab lists exactly this seller's listings.
      navigation.navigate('ContactProfile', {
        contact: {
          pubkey: sellerPubkey,
          name: sellerName,
          picture: null,
          lightningAddress: null,
          source: 'nostr',
        },
        initialTab: 'shop',
      });
      return;
    }
    const params = { merchant: sellerPubkey, mode };
    if (route.name === 'MarketProductDetail') {
      navigation.navigate('Market', params);
      return;
    }
    // The root-stack copy of this page (opened from a profile / note): go
    // back to the tabs rather than stacking a second Main on top.
    navigation.popTo('Main', {
      screen: 'MainTabs',
      params: { screen: 'Explore', params: { screen: 'Market', params } },
    });
  }, [catalogue, navigation, route.name, sellerName, sellerPubkey]);

  const showYouMightLike = shouldShowRecommendations(youMightLike);
  if (moreFromSeller.length === 0 && !showYouMightLike) return null;

  return (
    <View style={styles.container}>
      {moreFromSeller.length > 0 ? (
        <View style={styles.section} testID="product-more-from-seller">
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {t('market.recommendations.moreFromSeller', { seller: sellerName })}
            </Text>
            <TouchableOpacity
              style={styles.seeAll}
              onPress={onSeeAll}
              accessibilityRole="button"
              accessibilityLabel={t('market.recommendations.seeAllAccessibility', {
                seller: sellerName,
              })}
              testID="product-more-from-seller-see-all"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.seeAllText}>{t('market.recommendations.seeAll')}</Text>
              <ChevronRight size={16} color={colors.brandPink} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
          <ProductCarousel items={moreFromSeller} onPress={openProduct} styles={styles} />
        </View>
      ) : null}
      {showYouMightLike ? (
        <View style={styles.section} testID="product-you-might-like">
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {t('market.recommendations.youMightLike')}
            </Text>
          </View>
          <ProductCarousel items={youMightLike} onPress={openProduct} styles={styles} />
        </View>
      ) : null}
    </View>
  );
};

interface CarouselProps {
  items: MarketProduct[];
  onPress: (product: MarketProduct) => void;
  styles: MarketProductRecommendationsStyles;
}

const keyExtractor = (product: MarketProduct) => product.id;
const getItemLayout = (_: ArrayLike<MarketProduct> | null | undefined, index: number) => ({
  length: RECO_CARD_WIDTH,
  offset: ITEM_STRIDE * index,
  index,
});

const ProductCarousel = React.memo(function ProductCarousel({
  items,
  onPress,
  styles,
}: CarouselProps) {
  const renderItem = useCallback(
    ({ item }: { item: MarketProduct }) => {
      // Resolve the vendor once and reuse it for both props.
      const vendor = sellerOf(item);
      return (
        <MarketProductCard
          product={item}
          sellerName={vendor?.name ?? item.sellerName}
          vendor={vendor}
          variant="rail"
          onPress={onPress}
          testID={`product-reco-card-${recommendationCardId(item)}`}
        />
      );
    },
    [onPress],
  );
  const Separator = useCallback(() => <View style={styles.separator} />, [styles]);
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      renderItem={renderItem}
      ItemSeparatorComponent={Separator}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      initialNumToRender={3}
      maxToRenderPerBatch={4}
      windowSize={3}
    />
  );
});

export default MarketProductRecommendations;
