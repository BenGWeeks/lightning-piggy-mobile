import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, FlatList, Linking } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import MarketProductCard from '../components/MarketProductCard';
import MarketModeSelector from '../components/MarketModeSelector';
import MarketFilterBar from '../components/MarketFilterBar';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { createMarketScreenStyles } from '../styles/MarketScreen.styles';
import { MARKET_PRODUCTS, sellerOf, type MarketProduct } from '../data/marketProducts';
import { featuredFirst, vendorNostrPubkey } from '../utils/marketVendors';
import {
  DEFAULT_MARKET_MODE,
  marketModeOption,
  productsForMode,
  type MarketMode,
} from '../utils/marketMode';
import {
  distinctCurrencies,
  distinctLocations,
  filterMarketProducts,
  isMarketFilterActive,
  type MarketFilter,
} from '../utils/marketFilters';
import { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

// Resolve a product's seller Nostr pubkey (hex) from the vendor directory,
// used to filter by the user's web-of-trust follow set. Null when the seller
// has no Nostr identity (so it can never match a WoT mode).
const sellerPubkeyOf = (product: MarketProduct): string | null => {
  const vendor = sellerOf(product);
  return vendor ? vendorNostrPubkey(vendor) : null;
};

/**
 * Full "Market" screen — the "See all →" destination from the Explore hub's
 * Market rail. Lists individual PRODUCTS (image, title, price in sats, the
 * seller they come from), mirroring lightningpiggy.com/market/.
 *
 * A marketplace-mode selector at the top chooses which sellers products are
 * sourced from: Lightning Piggy preferred sellers (default), or the user's
 * Nostr web-of-trust friends. Friends-of-friends / all tiers are present but
 * disabled (coming soon). Tapping a product opens its shop URL.
 *
 * Data is the hardcoded {@link MARKET_PRODUCTS} catalogue, ported from the
 * website. A future live Nostr feed (NIP-15 products kind 30018 + NIP-99
 * classifieds kind 30402 — see the seam in `data/marketProducts.ts`) could
 * supplement or replace it without touching this screen.
 */
const MarketScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketScreenStyles(colors), [colors]);
  const { trustSet } = useTrustGraph();

  const [mode, setMode] = useState<MarketMode>(DEFAULT_MARKET_MODE);

  // Search + location + currency filters. The query is debounced so re-filtering
  // stays off the per-keystroke path; location/currency apply immediately.
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 250);

  // Mode-scoped catalogue (preferred sellers / WoT friends), featured-first.
  // This is the set the filter options and the filtered list both derive from.
  const baseProducts = useMemo(() => {
    const scoped = productsForMode(mode, MARKET_PRODUCTS, trustSet, sellerPubkeyOf);
    return featuredFirst(scoped);
  }, [mode, trustSet]);

  // Filter option lists sourced from the data actually loaded (not hardcoded).
  const locations = useMemo(() => distinctLocations(baseProducts, sellerOf), [baseProducts]);
  const currencies = useMemo(() => distinctCurrencies(baseProducts), [baseProducts]);

  const filter = useMemo<MarketFilter>(
    () => ({ query: debouncedQuery, location, currency }),
    [debouncedQuery, location, currency],
  );
  // `active` tracks the live (un-debounced) query so the Clear pill appears as
  // soon as the user types.
  const filterActive = isMarketFilterActive({ query, location, currency });

  const products = useMemo(
    () => filterMarketProducts(baseProducts, filter, sellerOf),
    [baseProducts, filter],
  );

  // Reset the three FILTER axes (search + location + currency). The
  // marketplace MODE (Preferred Sellers / WoT: Friends) is a separate
  // top-level selector above the filter bar, not a filter, so it is left
  // unchanged by design — "Clear filters" shouldn't yank the user out of the
  // WoT view they deliberately chose (Copilot review on #948).
  const clearFilters = useCallback(() => {
    setQuery('');
    setLocation(null);
    setCurrency(null);
  }, []);

  const openProduct = useCallback((product: MarketProduct) => {
    Linking.openURL(product.url).catch(() => {
      // Swallow — a malformed/unsupported URL shouldn't crash the screen.
    });
  }, []);

  const emptyCopy = filterActive
    ? 'No products match your search or filters.'
    : mode === 'wotFriends'
      ? 'None of your Nostr friends are selling Lightning Piggy products yet.'
      : 'No products available right now.';

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

      <View style={styles.modeBar}>
        <MarketModeSelector value={mode} onChange={setMode} />
        <Text style={styles.modeCaption}>Showing: {marketModeOption(mode).label}</Text>
      </View>

      <MarketFilterBar
        query={query}
        onChangeQuery={setQuery}
        locations={locations}
        selectedLocation={location}
        onSelectLocation={setLocation}
        currencies={currencies}
        selectedCurrency={currency}
        onSelectCurrency={setCurrency}
        active={filterActive}
        onClear={clearFilters}
      />

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.emptyWrap} testID="market-empty">
            <Text style={styles.emptyText}>{emptyCopy}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <MarketProductCard
            product={item}
            sellerName={sellerOf(item)?.name ?? item.sellerName}
            vendor={sellerOf(item)}
            variant="list"
            onPress={() => openProduct(item)}
            testID={`market-product-card-${item.id}`}
          />
        )}
      />
    </View>
  );
};

export default MarketScreen;
