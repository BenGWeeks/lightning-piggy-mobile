import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Image } from 'expo-image';
import { ChevronLeft, Zap, ExternalLink } from 'lucide-react-native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketProductDetailStyles } from '../styles/MarketProductDetailScreen.styles';
import { MARKET_PRODUCTS, sellerOf } from '../data/marketProducts';
import { marketFeedbackContext } from '../utils/marketFeedback';
import VendorAvatar from '../components/VendorAvatar';
import ProductFeedbackTabs from '../components/ProductFeedbackTabs';
import NostrLoginSheet from '../components/NostrLoginSheet';
import MarketCheckoutSheet from '../components/MarketCheckoutSheet';
import type {
  ExploreNavigation,
  MarketProductDetailRoute,
  RootStackParamList,
} from '../navigation/types';

// Composite nav type so the "Buy" flow can `navigate('Conversation', …)` after
// placing an order — the Conversation route lives on the root stack, not the
// Explore stack (same pattern as HuntPiggyDetailScreen).
type MarketProductDetailNavigation = CompositeNavigationProp<
  ExploreNavigation,
  NativeStackNavigationProp<RootStackParamList>
>;

interface Props {
  navigation: MarketProductDetailNavigation;
  route: MarketProductDetailRoute;
}

/**
 * Full Market PRODUCT page opened from a grid tile: product image, title,
 * price, seller (avatar + name), description and a buy affordance (opens the
 * seller's shop), followed by Nostr Reviews (kind 31555) + Comments (kind
 * 1111) in an underlined tabbed section — mirroring the companion website's
 * product page. Reviews/comments are shown only when the seller has a Nostr
 * identity to root them on.
 */
const MarketProductDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketProductDetailStyles(colors), [colors]);
  const [imageFailed, setImageFailed] = useState(false);
  const [loginVisible, setLoginVisible] = useState(false);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  const product = useMemo(
    () => MARKET_PRODUCTS.find((p) => p.id === route.params.productId),
    [route.params.productId],
  );
  const vendor = useMemo(() => (product ? sellerOf(product) : undefined), [product]);
  // Memoised so the comment-thread root identity stays stable across renders.
  const feedback = useMemo(
    () => (product ? marketFeedbackContext(product, vendor) : null),
    [product, vendor],
  );
  // In-app checkout is available exactly when the seller has a Nostr identity to
  // address the order to (same gate as reviews/comments). The merchant pubkey is
  // resolved once by `marketFeedbackContext`.
  const vendorPubkey = feedback?.merchantPubkey ?? null;

  const onRequestSignIn = useCallback(() => setLoginVisible(true), []);
  // In-app order for sellers with a Nostr identity; external website otherwise.
  const openShop = useCallback(() => {
    if (!product) return;
    if (vendorPubkey) {
      setCheckoutVisible(true);
      return;
    }
    Linking.openURL(product.url).catch(() => {
      // Swallow — a malformed/unsupported URL shouldn't crash the screen.
    });
  }, [product, vendorPubkey]);

  const onOrderPlaced = useCallback(
    (info: { vendorPubkey: string; vendorName: string; vendorLogo?: string }) => {
      navigation.navigate('Conversation', {
        pubkey: info.vendorPubkey,
        name: info.vendorName,
        picture: info.vendorLogo ?? null,
      });
    },
    [navigation],
  );

  if (!product) {
    return (
      <View style={styles.container} testID="market-product-detail-missing">
        <View style={styles.missing}>
          <Text style={styles.missingText}>This product is no longer available.</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Go back">
            <Text style={[styles.vendorName, { color: colors.brandPink, marginTop: 12 }]}>
              Back to Market
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const sellerName = vendor?.name ?? product.sellerName;
  const hasImage = product.image.length > 0 && !imageFailed;

  return (
    <View style={styles.container} testID="market-product-detail-screen">
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/learn-header-bg.png')}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <View style={styles.headerOverlay} />
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back to Market"
            testID="market-product-detail-back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {product.title}
          </Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.imageWrap}>
          {hasImage ? (
            <Image
              source={{ uri: product.image }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={product.image}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={styles.imageFallback}>
              <Text style={styles.imageFallbackText}>{product.title.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{product.title}</Text>
          <View style={styles.priceRow}>
            <Zap size={16} color={colors.brandPink} strokeWidth={2.5} fill={colors.brandPink} />
            <Text style={styles.priceSats} testID="market-product-detail-price">
              {product.priceSats.toLocaleString()} sats
            </Text>
            <Text style={styles.priceFiat}>· {product.priceFiatLabel}</Text>
          </View>

          <View style={styles.vendorRow}>
            {vendor ? <VendorAvatar vendor={vendor} size={24} /> : null}
            <Text style={styles.vendorName}>from {sellerName}</Text>
          </View>

          <Text style={styles.description}>{product.description}</Text>

          <TouchableOpacity
            style={styles.buyButton}
            onPress={openShop}
            testID="market-product-detail-buy"
            activeOpacity={0.85}
            accessibilityLabel={`Buy ${product.title} from ${sellerName}`}
          >
            <Zap size={16} color={colors.white} strokeWidth={2.5} fill={colors.white} />
            <Text style={styles.buyText}>Buy from {sellerName}</Text>
            {/* In-app checkout for Nostr sellers; the external-link glyph is only
                shown when tapping Buy leaves the app for the seller's website. */}
            {vendorPubkey ? null : (
              <ExternalLink size={16} color={colors.white} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {feedback ? (
          <View style={styles.feedbackWrap}>
            <ProductFeedbackTabs
              coord={feedback.reviewCoord}
              commentRoot={feedback.commentRoot}
              onRequestSignIn={onRequestSignIn}
            />
          </View>
        ) : (
          <View style={styles.noFeedback} testID="market-product-detail-no-feedback">
            <Text style={styles.noFeedbackText}>
              Reviews and comments aren&apos;t available for this seller yet — they need a Nostr
              identity to anchor feedback on.
            </Text>
          </View>
        )}
      </ScrollView>

      {vendorPubkey ? (
        <MarketCheckoutSheet
          visible={checkoutVisible}
          onClose={() => setCheckoutVisible(false)}
          product={product}
          sellerName={sellerName}
          vendorPubkey={vendorPubkey}
          vendorLogo={vendor?.logo}
          onRequestSignIn={onRequestSignIn}
          onPlaced={onOrderPlaced}
        />
      ) : null}

      <NostrLoginSheet visible={loginVisible} onClose={() => setLoginVisible(false)} />
    </View>
  );
};

export default MarketProductDetailScreen;
