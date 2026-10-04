import React, { useMemo, useState } from 'react';
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

  const candidateKey = JSON.stringify([picture, vendor.logo]);
  const [failures, setFailures] = useState<{ key: string; uris: string[] }>({
    key: candidateKey,
    uris: [],
  });
  const failedUris = failures.key === candidateKey ? failures.uris : [];
  const uri =
    [picture, vendor.logo].find(
      (candidate): candidate is string =>
        !!candidate && isSupportedImageUrl(candidate) && !failedUris.includes(candidate),
    ) ?? null;

  const dimension = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.container, dimension]} testID={testID} accessibilityLabel={vendor.name}>
      {uri ? (
        <Image
          source={{ uri }}
          testID={testID ? `${testID}-image` : undefined}
          onError={() =>
            setFailures((previous) => ({
              key: candidateKey,
              uris: [...(previous.key === candidateKey ? previous.uris : []), uri],
            }))
          }
          style={dimension}
          cachePolicy="memory-disk"
          // Identity follows the PROFILE picture (as the other avatar
          // surfaces do); the curated logo is only the null fallback.
          recyclingKey={picture ?? uri}
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
