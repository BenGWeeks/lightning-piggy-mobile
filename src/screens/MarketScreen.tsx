import React, { useCallback, useMemo } from 'react';
import { View, Text, Image, TouchableOpacity, FlatList, Linking } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import MarketVendorCard from '../components/MarketVendorCard';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketScreenStyles } from '../styles/MarketScreen.styles';
import { MARKET_VENDORS, type MarketVendor } from '../data/marketVendors';
import { featuredFirst, vendorSlug } from '../utils/marketVendors';
import { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Full "Market" screen — the "See all →" destination from the Explore
 * hub's Market rail. Lists every Lightning Piggy vendor (featured first).
 * Tapping a vendor opens its shop URL in the system browser.
 *
 * Data is the hardcoded {@link MARKET_VENDORS} directory, ported from the
 * website's `vendors.json`. A future live Nostr feed (NIP-15 kind 30018 +
 * NIP-99 kind 30402 — see the seam documented in `data/marketVendors.ts`)
 * could supplement or replace it without touching this screen.
 */
const MarketScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketScreenStyles(colors), [colors]);

  const vendors = useMemo(() => featuredFirst(MARKET_VENDORS), []);

  const openVendor = useCallback((vendor: MarketVendor) => {
    // External shop link — open in the system browser. nostrUrl is an
    // njump.me web link too, so url is always the right primary target.
    Linking.openURL(vendor.url).catch(() => {
      // Swallow — a malformed/unsupported URL shouldn't crash the screen.
    });
  }, []);

  return (
    <View style={styles.container} testID="market-screen">
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
            accessibilityLabel="Back to Explore"
            testID="market-back-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Market</Text>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.headerTagline}>Buy a Lightning Piggy &amp; Bitcoin merch</Text>
      </View>

      <FlatList
        data={vendors}
        keyExtractor={(v) => vendorSlug(v.name)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <MarketVendorCard vendor={item} variant="list" onPress={() => openVendor(item)} />
        )}
      />
    </View>
  );
};

export default MarketScreen;
