import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { ChevronLeft, Zap, ExternalLink } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketProductDetailStyles } from '../styles/MarketProductDetailScreen.styles';
import { MARKET_PRODUCTS, sellerOf } from '../data/marketProducts';
import { marketFeedbackContext } from '../utils/marketFeedback';
import VendorAvatar from '../components/VendorAvatar';
import ProductFeedbackTabs from '../components/ProductFeedbackTabs';
import NostrLoginSheet from '../components/NostrLoginSheet';
import type { ExploreNavigation, MarketProductDetailRoute } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
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

  const onRequestSignIn = useCallback(() => setLoginVisible(true), []);
  const openShop = useCallback(() => {
    if (!product) return;
    Linking.openURL(product.url).catch(() => {
      // Swallow — a malformed/unsupported URL shouldn't crash the screen.
    });
  }, [product]);

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
              resizeMode="cover"
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
            <ExternalLink size={16} color={colors.white} strokeWidth={2.5} />
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

      <NostrLoginSheet visible={loginVisible} onClose={() => setLoginVisible(false)} />
    </View>
  );
};

export default MarketProductDetailScreen;
