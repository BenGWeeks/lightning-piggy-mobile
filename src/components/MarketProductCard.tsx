import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketProductCardStyles } from '../styles/MarketProductCard.styles';
import type { MarketProduct } from '../data/marketProducts';

interface Props {
  product: MarketProduct;
  /** Display name of the seller/shop the product comes from (resolved by
   * the caller from the vendor directory; falls back to `sellerName`). */
  sellerName: string;
  /** Tapped to open the product / "Buy" link. */
  onPress: () => void;
  /**
   * `rail` — fixed-width vertical card for the Explore horizontal rail.
   * `list` — full-width card for the Market screen list.
   */
  variant: 'rail' | 'list';
  /** testID base, e.g. `market-product-card-<id>`. */
  testID?: string;
}

/**
 * Reusable Market PRODUCT card, shared by the Explore "Market" rail and the
 * full Market screen. Leads with the product image, then shows the title,
 * price in sats, and the seller/shop it comes from — mirroring the product
 * grid on lightningpiggy.com/market/.
 */
const MarketProductCard: React.FC<Props> = ({ product, sellerName, onPress, variant, testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketProductCardStyles(colors), [colors]);
  // Fall back to a branded placeholder tile if the image 404s / dead host.
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = product.image.length > 0 && !imageFailed;

  const cardStyle = variant === 'rail' ? styles.railCard : styles.listCard;

  const image = (
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
      {product.featured ? (
        <View style={styles.featuredBadge} testID={testID ? `${testID}-featured` : undefined}>
          <Zap size={9} color={colors.zapYellowInk} strokeWidth={2.5} fill={colors.zapYellowInk} />
          <Text style={styles.featuredText}>Featured</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <TouchableOpacity
      style={cardStyle}
      onPress={onPress}
      accessibilityLabel={`${product.title} — ${product.priceSats.toLocaleString()} sats from ${sellerName}`}
      testID={testID}
      activeOpacity={0.8}
    >
      {image}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {product.title}
        </Text>
        <View style={styles.priceRow}>
          <Zap size={12} color={colors.brandPink} strokeWidth={2.5} fill={colors.brandPink} />
          <Text style={styles.price} testID={testID ? `${testID}-price` : undefined}>
            {product.priceSats.toLocaleString()} sats
          </Text>
        </View>
        <Text style={styles.seller} numberOfLines={1}>
          from {sellerName}
        </Text>
        {variant === 'list' ? (
          <Text style={styles.description} numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

export default MarketProductCard;
