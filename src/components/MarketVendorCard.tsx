import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { Globe, Store, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketVendorCardStyles } from '../styles/MarketVendorCard.styles';
import type { MarketVendor } from '../data/marketVendors';
import { shopTypeLabel, vendorLocationLine, vendorSlug } from '../utils/marketVendors';

interface Props {
  vendor: MarketVendor;
  onPress: () => void;
  /**
   * `rail` — fixed-width vertical card for the Explore horizontal rail.
   * `list` — full-width horizontal row for the Market screen list.
   */
  variant: 'rail' | 'list';
}

/**
 * Reusable Market vendor card, shared by the Explore "Market" rail and the
 * full Market screen. Shows the vendor's logo (with a monogram fallback
 * when missing or broken), name, country + shop type, a short description,
 * and an unconditional "⚡ Bitcoin accepted" affordance (every vendor in
 * this curated directory takes Bitcoin).
 *
 * Mirrors the website's `VendorCard.astro` field layout so the two stay
 * recognisably the same product.
 */
const MarketVendorCard: React.FC<Props> = ({ vendor, onPress, variant }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketVendorCardStyles(colors), [colors]);
  // Track logo load failure so a 404 / dead host falls back to the
  // monogram tile instead of a blank box (parity with the website's
  // onerror handler).
  const [logoFailed, setLogoFailed] = useState(false);

  const slug = vendorSlug(vendor.name);
  const showLogo = vendor.logo.length > 0 && !logoFailed;

  const logo = (
    <View style={styles.logoWrap}>
      {showLogo ? (
        <Image
          source={{ uri: vendor.logo }}
          style={styles.logo}
          resizeMode="cover"
          onError={() => setLogoFailed(true)}
          accessibilityLabel={`${vendor.name} logo`}
        />
      ) : (
        <View style={styles.logoFallback}>
          <Text style={styles.logoFallbackText}>{vendor.name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
    </View>
  );

  const ShopIcon = vendor.shopType === 'physical' ? Store : Globe;
  const shopType = (
    <View style={styles.shopTypeRow}>
      <ShopIcon size={12} color={colors.textSupplementary} strokeWidth={2} />
      <Text style={styles.meta} numberOfLines={1}>
        {shopTypeLabel(vendor.shopType)}
      </Text>
    </View>
  );

  const btcAffordance = (
    <View style={styles.btcRow}>
      <Zap size={12} color={colors.brandPink} strokeWidth={2.5} fill={colors.brandPink} />
      <Text style={styles.btcText}>Bitcoin accepted</Text>
    </View>
  );

  const featuredBadge = vendor.featured ? (
    <View style={styles.featuredBadge} testID={`market-vendor-card-${slug}-featured`}>
      <Zap size={9} color={colors.zapYellowInk} strokeWidth={2.5} fill={colors.zapYellowInk} />
      <Text style={styles.featuredText}>Featured</Text>
    </View>
  ) : null;

  if (variant === 'rail') {
    return (
      <TouchableOpacity
        style={styles.railCard}
        onPress={onPress}
        accessibilityLabel={`${vendor.name} — open shop`}
        testID={`market-vendor-card-${slug}`}
        activeOpacity={0.8}
      >
        {featuredBadge}
        <View style={styles.railLogoRow}>{logo}</View>
        <Text style={styles.name} numberOfLines={1}>
          {vendor.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {vendor.country}
        </Text>
        {shopType}
        <Text style={styles.description} numberOfLines={2}>
          {vendor.description}
        </Text>
        {btcAffordance}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.listRow}
      onPress={onPress}
      accessibilityLabel={`${vendor.name} — open shop`}
      testID={`market-vendor-card-${slug}`}
      activeOpacity={0.8}
    >
      {logo}
      <View style={styles.listBody}>
        <Text style={styles.name} numberOfLines={1}>
          {vendor.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {vendorLocationLine(vendor)}
        </Text>
        {shopType}
        <Text style={styles.description} numberOfLines={3}>
          {vendor.description}
        </Text>
        {btcAffordance}
      </View>
      {featuredBadge}
    </TouchableOpacity>
  );
};

export default MarketVendorCard;
