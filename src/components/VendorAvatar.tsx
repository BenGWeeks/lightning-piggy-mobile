import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { useThemeColors } from '../contexts/ThemeContext';
import { createVendorAvatarStyles } from '../styles/VendorAvatar.styles';
import { usePubkeyProfile } from '../hooks/usePubkeyProfile';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { vendorNostrPubkey } from '../utils/marketVendors';
import type { MarketVendor } from '../data/marketVendors';

interface Props {
  /** The seller this product comes from. */
  vendor: MarketVendor;
  /** Diameter in dp. */
  size?: number;
  testID?: string;
}

/**
 * Small circular vendor/merchant avatar for Market product rows.
 *
 * Resolves the seller's Nostr kind-0 `picture` via {@link usePubkeyProfile}
 * (keyed on the vendor's npub → hex), and renders it with `expo-image`
 * memory-disk caching so the same merchant avatar paints instantly across the
 * rail and the list without re-fetching.
 *
 * Source priority: the live kind-0 avatar, then the curated `vendor.logo` as a
 * warm/offline fallback, then a branded initial tile when neither is a usable
 * image. Vendors without a Nostr identity (`vendorNostrPubkey` → null) skip the
 * relay path entirely and fall straight through to the logo — so this adds no
 * per-row relay traffic for the non-Nostr sellers.
 */
const VendorAvatar: React.FC<Props> = ({ vendor, size = 28, testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createVendorAvatarStyles(colors), [colors]);
  // Only the vendors with an npub resolve a pubkey; the rest pass null, which
  // makes usePubkeyProfile a no-op (no relay round-trip).
  const pubkey = useMemo(() => vendorNostrPubkey(vendor), [vendor]);
  const { picture } = usePubkeyProfile(pubkey);

  // Prefer the live kind-0 avatar; fall back to the curated logo.
  const uri =
    picture && isSupportedImageUrl(picture)
      ? picture
      : isSupportedImageUrl(vendor.logo)
        ? vendor.logo
        : null;

  const dimension = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.container, dimension]} testID={testID} accessibilityLabel={vendor.name}>
      {uri ? (
        <Image
          source={{ uri }}
          style={dimension}
          cachePolicy="memory-disk"
          recyclingKey={uri}
          autoplay={false}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.fallback, dimension]}>
          <Text style={[styles.fallbackText, { fontSize: size * 0.45 }]}>
            {vendor.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
};

export default VendorAvatar;
