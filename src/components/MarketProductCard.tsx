import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketProductCardStyles } from '../styles/MarketProductCard.styles';
import VendorAvatar from './VendorAvatar';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketVendor } from '../data/marketVendors';

interface Props {
  product: MarketProduct;
  /** Display name of the seller/shop the product comes from (resolved by
   * the caller from the vendor directory; falls back to `sellerName`). */
  sellerName: string;
  /** The resolved seller, when known — drives the merchant avatar (its Nostr
   * kind-0 picture, with the curated logo as fallback). Omitted when the
   * caller can't resolve the vendor; the row then shows just the name. */
  vendor?: MarketVendor;
  /** Tapped to open the product / "Buy" link. */
  onPress: () => void;
  /**
   * `rail` — fixed-width vertical card for the Explore horizontal rail.
   * `list` — full-width card for the Market screen list.
   * `grid` — roughly-square tile for the Market screen 2-column grid (the
   *   caller sizes the tile via a fixed-width wrapper; the card fills it).
   */
  variant: 'rail' | 'list' | 'grid';
  /** testID base, e.g. `market-product-card-<id>`. */
  testID?: string;
}

/**
 * Reusable Market PRODUCT card, shared by the Explore "Market" rail and the
 * full Market screen. Leads with the product image, then shows the title,
 * price in sats, and the seller/shop it comes from — mirroring the product
 * grid on lightningpiggy.com/market/.
 */
const MarketProductCard: React.FC<Props> = ({
  product,
  sellerName,
  vendor,
  onPress,
  variant,
  testID,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketProductCardStyles(colors), [colors]);
  // Fall back to a branded placeholder tile if the image 404s / dead host.
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = product.image.length > 0 && !imageFailed;

  const isGrid = variant === 'grid';
  const cardStyle =
    variant === 'rail' ? styles.railCard : isGrid ? styles.gridCard : styles.listCard;

  const image = (
    <View style={isGrid ? styles.gridImageWrap : styles.imageWrap}>
      {hasImage ? (
        <Image
          source={{ uri: product.image }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          // Stable key so recycled grid tiles don't briefly show the previous
          // tile's image while scrolling the virtualized list.
          recyclingKey={product.image}
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
      <View style={isGrid ? styles.gridBody : styles.body}>
        <Text style={[styles.title, isGrid && styles.gridTitle]} numberOfLines={2}>
          {product.title}
        </Text>
        <View style={styles.priceRow}>
          <Zap size={12} color={colors.brandPink} strokeWidth={2.5} fill={colors.brandPink} />
          <Text style={styles.price} testID={testID ? `${testID}-price` : undefined}>
            {product.priceSats.toLocaleString()} sats
          </Text>
        </View>
        <View style={styles.sellerRow}>
          {vendor ? (
            <VendorAvatar
              vendor={vendor}
              size={isGrid ? 16 : 20}
              testID={testID ? `${testID}-vendor-avatar` : undefined}
            />
          ) : null}
          <Text style={styles.seller} numberOfLines={1}>
            from {sellerName}
          </Text>
        </View>
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
