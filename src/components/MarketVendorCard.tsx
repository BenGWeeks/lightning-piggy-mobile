import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Globe, MessageCircle, Store, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketVendorCardStyles } from '../styles/MarketVendorCard.styles';
import type { MarketVendor } from '../data/marketVendors';
import {
  shopTypeLabel,
  vendorLocationLine,
  vendorHasNostr,
  vendorSlug,
} from '../utils/marketVendors';

interface Props {
  vendor: MarketVendor;
  onPress: () => void;
  /**
   * Tapped when the user wants to reach the vendor on Nostr (message / zap
   * them in-app). Only rendered when the vendor has a Nostr identity
   * (`vendorHasNostr`); omit it (or leave the vendor npub-less) to hide the
   * affordance. Vendors without an npub keep website-only behaviour.
   */
  onNostr?: () => void;
  /**
   * `rail` — fixed-width vertical card for the Explore horizontal rail.
   * `list` — full-width horizontal row for the Market screen list.
   */
  variant: 'rail' | 'list';
}

/**
 * Reusable Market vendor card, shared by the Explore "Market" rail and the
 * full Market screen. Shows a cover/banner image (so it reads like the
 * other Explore carousels — Lessons / Places / Geo-caches, which all lead
 * with a cover) with the vendor's logo overlaid, the name, country + shop
 * type, a short description, and an unconditional "⚡ Bitcoin accepted"
 * affordance (every vendor in this curated directory takes Bitcoin).
 *
 * Banner resolution (rail variant): vendors with a `banner` URL (baked in
 * at author time from their site's og:image — see `marketVendors.ts`) show
 * it; otherwise the card falls back to a tasteful branded banner — the
 * logo blurred as a backdrop, or a Lightning Piggy pink gradient when even
 * the logo is missing. The crisp logo always sits on top either way.
 *
 * Mirrors the website's `VendorCard.astro` field layout so the two stay
 * recognisably the same product.
 */
const MarketVendorCard: React.FC<Props> = ({ vendor, onPress, onNostr, variant }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketVendorCardStyles(colors), [colors]);
  // Track logo load failure so a 404 / dead host falls back to the
  // monogram tile instead of a blank box (parity with the website's
  // onerror handler).
  const [logoFailed, setLogoFailed] = useState(false);
  // Track banner load failure independently so a dead og:image host falls
  // back to the branded banner rather than a blank box.
  const [bannerFailed, setBannerFailed] = useState(false);

  const slug = vendorSlug(vendor.name);
  const hasLogo = vendor.logo.length > 0 && !logoFailed;
  const hasBanner = !!vendor.banner && !bannerFailed;

  const logo = (
    <View style={styles.logoWrap}>
      {hasLogo ? (
        <Image
          source={{ uri: vendor.logo }}
          style={styles.logo}
          resizeMode="cover"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <View style={styles.logoFallback}>
          <Text style={styles.logoFallbackText}>{vendor.name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
    </View>
  );

  // Branded fallback backdrop used when the vendor has no usable og:image
  // banner: the logo blurred to fill the banner, or — if there's no logo
  // either — a Lightning Piggy pink→purple gradient. The crisp `logo`
  // overlay (rendered by the caller) always sits on top.
  const fallbackBackdrop = hasLogo ? (
    <Image
      source={{ uri: vendor.logo }}
      style={styles.bannerImage}
      resizeMode="cover"
      blurRadius={18}
      onError={() => setLogoFailed(true)}
    />
  ) : (
    <LinearGradient
      colors={[colors.brandPink, colors.brandPurple]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.bannerImage}
    />
  );

  // Full-bleed banner header (rail variant): real og:image cover when we
  // have one, branded fallback otherwise. The logo + featured badge are
  // overlaid so the card leads with a cover image like its sibling rails.
  const banner = (
    <View style={styles.bannerWrap}>
      {hasBanner ? (
        <Image
          source={{ uri: vendor.banner }}
          style={styles.bannerImage}
          resizeMode="cover"
          onError={() => setBannerFailed(true)}
        />
      ) : (
        fallbackBackdrop
      )}
      <View style={styles.bannerLogo}>{logo}</View>
      {vendor.featured ? (
        <View style={styles.featuredBadge} testID={`market-vendor-card-${slug}-featured`}>
          <Zap size={9} color={colors.zapYellowInk} strokeWidth={2.5} fill={colors.zapYellowInk} />
          <Text style={styles.featuredText}>Featured</Text>
        </View>
      ) : null}
    </View>
  );

  // Globe only for online-only vendors; anything with a physical presence
  // (`physical` or `both`) gets the Store icon so it matches the label
  // ("Online & Physical" no longer shows a Globe).
  const ShopIcon = vendor.shopType === 'online' ? Globe : Store;
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

  // Nostr affordance — only for vendors with an npub AND a handler wired.
  // Opens the vendor's in-app contact profile (where Message / Zap live)
  // instead of their website. `stopPropagation`-style guard: the button
  // sits inside the card's TouchableOpacity, so its own onPress fires the
  // Nostr action without also triggering the card's "open shop" press.
  const showNostr = !!onNostr && vendorHasNostr(vendor);
  const nostrButton = showNostr ? (
    <TouchableOpacity
      style={styles.nostrButton}
      onPress={onNostr}
      accessibilityLabel={`Message or zap ${vendor.name} on Nostr`}
      testID={`market-vendor-card-${slug}-nostr`}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      activeOpacity={0.7}
    >
      <MessageCircle size={16} color={colors.brandPurple} strokeWidth={2.25} />
    </TouchableOpacity>
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
        {banner}
        <View style={styles.railBody}>
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
          <View style={styles.footerRow}>
            {btcAffordance}
            {nostrButton}
          </View>
        </View>
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
        <View style={styles.footerRow}>
          {btcAffordance}
          {nostrButton}
        </View>
      </View>
      {vendor.featured ? (
        <View style={styles.featuredBadge} testID={`market-vendor-card-${slug}-featured`}>
          <Zap size={9} color={colors.zapYellowInk} strokeWidth={2.5} fill={colors.zapYellowInk} />
          <Text style={styles.featuredText}>Featured</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

export default MarketVendorCard;
