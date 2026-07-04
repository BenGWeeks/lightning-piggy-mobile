import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { ChevronLeft, Search, SlidersHorizontal, X } from 'lucide-react-native';
import MarketProductCard from '../components/MarketProductCard';
import MarketModeSelector from '../components/MarketModeSelector';
import MarketFilterBar from '../components/MarketFilterBar';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
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
  countActiveMarketFilters,
  distinctCountries,
  distinctCurrencies,
  distinctMerchants,
  filterMarketProducts,
  isMarketFilterActive,
  type MarketFilter,
} from '../utils/marketFilters';
import { MARKET_GRID_COLUMNS, marketGridTileWidth } from '../utils/marketGrid';
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
  const t = useTranslation();
  const styles = useMemo(() => createMarketScreenStyles(colors), [colors]);
  const { trustSet } = useTrustGraph();

  // Derive the square tile width from the live window so rotation / tablet
  // widths stay a clean 2-up grid; a fixed width (not flex) also keeps a lone
  // last tile in an odd-length list at column width instead of stretching.
  const { width: windowWidth } = useWindowDimensions();
  const tileWidth = useMemo(() => marketGridTileWidth(windowWidth), [windowWidth]);

  const [mode, setMode] = useState<MarketMode>(DEFAULT_MARKET_MODE);

  // The category filters (merchant / country / currency) live in a right-anchored
  // slide-in panel to keep the main view compact; the search box stays inline.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Search + merchant + country + currency filters. The query is debounced so
  // re-filtering stays off the per-keystroke path; the chip axes apply
  // immediately.
  const [query, setQuery] = useState('');
  const [merchant, setMerchant] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 250);

  // Mode-scoped catalogue (preferred sellers / WoT friends), featured-first.
  // This is the set the filter options and the filtered list both derive from.
  const baseProducts = useMemo(() => {
    const scoped = productsForMode(mode, MARKET_PRODUCTS, trustSet, sellerPubkeyOf);
    return featuredFirst(scoped);
  }, [mode, trustSet]);

  // Filter option lists sourced from the data actually loaded (not hardcoded).
  const merchants = useMemo(() => distinctMerchants(baseProducts, sellerOf), [baseProducts]);
  const countries = useMemo(() => distinctCountries(baseProducts, sellerOf), [baseProducts]);
  const currencies = useMemo(() => distinctCurrencies(baseProducts), [baseProducts]);

  const filter = useMemo<MarketFilter>(
    () => ({ query: debouncedQuery, merchant, country, currency }),
    [debouncedQuery, merchant, country, currency],
  );
  // `active` tracks the live (un-debounced) query so the empty-state copy flips
  // as soon as the user types.
  const filterActive = isMarketFilterActive({ query, merchant, country, currency });
  // Count of active CATEGORY axes (merchant / country / currency) — the ones
  // housed in the panel. Drives the badge on the header's filter icon and the
  // panel's own "Clear filters" affordance (the inline search has its own
  // clear button, so it is excluded here).
  const categoryFilterCount = countActiveMarketFilters({
    query,
    merchant,
    country,
    currency,
  });

  const products = useMemo(
    () => filterMarketProducts(baseProducts, filter, sellerOf),
    [baseProducts, filter],
  );

  // Reset the CATEGORY filter axes (merchant + country + currency) from inside
  // the panel. The inline search keeps its own clear button, so it is left
  // untouched here. The marketplace MODE (Preferred Sellers / WoT: Friends) is
  // a separate top-level selector, not a filter, so it is also left unchanged by
  // design — "Clear filters" shouldn't yank the user out of the WoT view they
  // deliberately chose (Copilot review on #948).
  const clearFilters = useCallback(() => {
    setMerchant(null);
    setCountry(null);
    setCurrency(null);
  }, []);

  const openProduct = useCallback(
    (product: MarketProduct) => {
      navigation.navigate('MarketProductDetail', { productId: product.id });
    },
    [navigation],
  );

  const renderProduct = useCallback(
    ({ item }: { item: MarketProduct }) => {
      // Resolve the vendor once — `sellerOf` linearly scans MARKET_VENDORS, so
      // reuse the result for both `sellerName` and `vendor` (Copilot review on
      // #948).
      const vendor = sellerOf(item);
      return (
        // Fixed-width wrapper sizes the tile; the card fills it (width: '100%').
        // This is what keeps a lone last tile from stretching full-width.
        <View style={{ width: tileWidth }}>
          <MarketProductCard
            product={item}
            sellerName={vendor?.name ?? item.sellerName}
            vendor={vendor}
            variant="grid"
            onPress={() => openProduct(item)}
            testID={`market-product-card-${item.id}`}
          />
        </View>
      );
    },
    [tileWidth, openProduct],
  );

  const emptyCopy = filterActive
    ? t('market.screen.emptyNoMatch')
    : mode === 'wotFriends'
      ? t('market.screen.emptyNoFriends')
      : t('market.screen.emptyNone');

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
            accessibilityLabel={t('market.screen.back')}
            testID="market-back-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('market.screen.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.headerTagline}>{t('market.screen.tagline')}</Text>
      </View>

      <View style={styles.modeBar}>
        <MarketModeSelector value={mode} onChange={setMode} />
        <Text style={styles.modeCaption}>
          {t('market.screen.showing', { label: marketModeOption(mode).label })}
        </Text>
      </View>

      {/* Inline search + a compact filter icon that opens the slide-in panel.
          Keeping only this single row (instead of three chip rows) reclaims the
          vertical space so the product grid starts higher. */}
      <View style={styles.searchBar}>
        <View style={styles.searchRow}>
          <Search size={16} color={colors.textSupplementary} strokeWidth={2.25} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('market.screen.searchPlaceholder')}
            placeholderTextColor={colors.textSupplementary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            testID="market-search-input"
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              accessibilityLabel={t('market.screen.clearSearch')}
              testID="market-search-clear"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={16} color={colors.textSupplementary} strokeWidth={2.25} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.filterButton, categoryFilterCount > 0 && styles.filterButtonActive]}
          onPress={() => setFiltersOpen(true)}
          accessibilityLabel={
            categoryFilterCount > 0
              ? t('market.screen.filtersApplied', { count: categoryFilterCount })
              : t('market.screen.filters')
          }
          testID="market-filter-button"
          activeOpacity={0.7}
        >
          <SlidersHorizontal
            size={18}
            color={categoryFilterCount > 0 ? colors.white : colors.textBody}
            strokeWidth={2.25}
          />
          {categoryFilterCount > 0 ? (
            <View style={styles.filterBadge} testID="market-filter-badge">
              <Text style={styles.filterBadgeText}>{categoryFilterCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <MarketFilterBar
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        merchants={merchants}
        selectedMerchant={merchant}
        onSelectMerchant={setMerchant}
        countries={countries}
        selectedCountry={country}
        onSelectCountry={setCountry}
        currencies={currencies}
        selectedCurrency={currency}
        onSelectCurrency={setCurrency}
        active={categoryFilterCount > 0}
        onClear={clearFilters}
      />

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={MARKET_GRID_COLUMNS}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        removeClippedSubviews
        initialNumToRender={8}
        windowSize={7}
        ListEmptyComponent={
          <View style={styles.emptyWrap} testID="market-empty">
            <Text style={styles.emptyText}>{emptyCopy}</Text>
          </View>
        }
        renderItem={renderProduct}
      />
    </View>
  );
};

export default MarketScreen;
