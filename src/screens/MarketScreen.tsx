import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { ChevronLeft, Search, SlidersHorizontal, Store, X } from 'lucide-react-native';
import MarketProductCard from '../components/MarketProductCard';
import MarketFilterBar from '../components/MarketFilterBar';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { usePreferredMarketListings } from '../hooks/usePreferredMarketListings';
import { useMarketListings } from '../hooks/useMarketListings';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { createMarketScreenStyles } from '../styles/MarketScreen.styles';
import { sellerOf, type MarketProduct } from '../data/marketProducts';
import { featuredFirst } from '../utils/marketVendors';
import { useMarketPreferences } from '../hooks/useMarketPreferences';
import { validateMarketPreferences } from '../utils/marketPreferences';
import { marketLoadingStatus } from '../utils/marketLoadingStatus';
import { DEFAULT_MARKET_MODE, type MarketMode } from '../utils/marketMode';
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
import { perfLog } from '../utils/perfLog';

interface Props {
  navigation: ExploreNavigation;
}

/** Preferred catalogue or foreground relay listings from the viewer's direct follows. */
const MarketScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketScreenStyles(colors), [colors]);

  // Derive the square tile width from the live window so rotation / tablet
  // widths stay a clean 2-up grid; a fixed width (not flex) also keeps a lone
  // last tile in an odd-length list at column width instead of stretching.
  const { width: windowWidth } = useWindowDimensions();
  const tileWidth = useMemo(() => marketGridTileWidth(windowWidth), [windowWidth]);

  const { ready, preferences, update } = useMarketPreferences();
  const { mode, merchant, country, currency } = preferences;
  const friends = useMarketListings(ready && mode === 'wotFriends');
  const preferred = usePreferredMarketListings(ready && mode === 'preferred');
  const live = mode === 'wotFriends' ? friends : preferred;
  const setMerchant = useCallback((merchant: string | null) => update({ merchant }), [update]);
  const setCountry = useCallback((country: string | null) => update({ country }), [update]);
  const setCurrency = useCallback((currency: string | null) => update({ currency }), [update]);
  const selectMode = useCallback(
    (next: MarketMode) => {
      perfLog(`[PerfBlock] market mode tap ${next}`);
      update({ mode: next });
    },
    [update],
  );
  // Pairs with the tap marker above: the delta is tap-to-commit latency.
  useEffect(() => {
    perfLog(`[PerfBlock] market mode committed ${mode}`);
  }, [mode]);

  // The category filters (merchant / country / currency) live in a right-anchored
  // slide-in panel to keep the main view compact; the search box stays inline.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Search + merchant + country + currency filters. The query is debounced so
  // re-filtering stays off the per-keystroke path; the chip axes apply
  // immediately.
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);

  // Mode-scoped catalogue (preferred sellers / WoT friends), featured-first.
  // This is the set the filter options and the filtered list both derive from.
  const baseProducts = useMemo(() => {
    return ready ? featuredFirst(live.products) : [];
  }, [ready, live.products]);

  // Filter option lists sourced from the data actually loaded (not hardcoded).
  const merchants = useMemo(() => distinctMerchants(baseProducts, sellerOf), [baseProducts]);
  const countries = useMemo(() => distinctCountries(baseProducts, sellerOf), [baseProducts]);
  const currencies = useMemo(() => distinctCurrencies(baseProducts), [baseProducts]);

  // Reconcile the category selections with the option lists whenever the
  // mode-scoped catalogue changes: a merchant / country / currency picked under
  // one mode may not exist under the next, and a chip that no longer renders
  // can't be un-selected from its axis — the grid would just sit empty.
  useEffect(() => {
    if (!ready || !live.completed || live.loading || live.incomplete) return;
    const validated = validateMarketPreferences(preferences, { merchants, countries, currencies });
    if (
      validated.merchant !== merchant ||
      validated.country !== country ||
      validated.currency !== currency
    )
      update(validated);
  }, [
    ready,
    mode,
    live.completed,
    live.loading,
    live.incomplete,
    merchants,
    countries,
    currencies,
    merchant,
    country,
    currency,
    preferences,
    update,
  ]);

  const filter = useMemo<MarketFilter>(
    () => ({ query: debouncedQuery, merchant, country, currency }),
    [debouncedQuery, merchant, country, currency],
  );
  // `active` tracks the live (un-debounced) query so the empty-state copy flips
  // as soon as the user types.
  const filterActive = isMarketFilterActive({ query, merchant, country, currency });
  // Seller scope shares the panel's badge and Clear action. Search also
  // contributes to the button badge, but retains its own clear control.
  const panelFilterCount = countActiveMarketFilters({ query, merchant, country, currency }, mode);
  const activeFilterCount = panelFilterCount + (query.trim().length > 0 ? 1 : 0);

  const products = useMemo(
    () => filterMarketProducts(baseProducts, filter, sellerOf),
    [baseProducts, filter],
  );

  const clearFilters = useCallback(() => {
    setMerchant(null);
    setCountry(null);
    setCurrency(null);
    selectMode(DEFAULT_MARKET_MODE);
  }, [selectMode, setMerchant, setCountry, setCurrency]);

  const openProduct = useCallback(
    (product: MarketProduct) => {
      perfLog('[PerfBlock] market product tap');
      navigation.navigate('MarketProductDetail', { productId: product.id, product });
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
            onPress={openProduct}
            testID={`market-product-card-${item.id}`}
          />
        </View>
      );
    },
    [tileWidth, openProduct],
  );

  const emptyCopy =
    live.loading && baseProducts.length === 0
      ? t('market.live.loading')
      : filterActive
        ? t('market.screen.emptyNoMatch')
        : mode === 'wotFriends'
          ? t('market.screen.emptyNoFriends')
          : t('market.screen.emptyNone');

  if (!ready) return <View style={styles.container} testID="market-screen" />;

  return (
    <View style={styles.container} testID="market-screen">
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/learn-header-bg.png')}
          style={styles.headerImage}
          contentFit="cover"
          cachePolicy="memory-disk"
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
          {/* Seller side (#1273): set up a shop and list your own items. */}
          <TouchableOpacity
            onPress={() => navigation.navigate('MarketMyShop')}
            accessibilityLabel={t('market.sell.myShopAccessibility')}
            testID="market-my-shop-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Store size={24} color={colors.white} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTagline}>{t('market.screen.tagline')}</Text>
      </View>

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
          style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}
          onPress={() => {
            perfLog('[PerfBlock] market filter tap');
            setFiltersOpen(true);
          }}
          accessibilityLabel={
            activeFilterCount > 0
              ? t('market.screen.filtersApplied', { count: activeFilterCount })
              : t('market.screen.filters')
          }
          testID="market-filter-button"
          activeOpacity={0.7}
        >
          <SlidersHorizontal
            size={18}
            color={activeFilterCount > 0 ? colors.white : colors.textBody}
            strokeWidth={2.25}
          />
          {activeFilterCount > 0 ? (
            <View style={styles.filterBadge} testID="market-filter-badge">
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      {mode !== DEFAULT_MARKET_MODE ? (
        <View style={styles.scopeRow}>
          <TouchableOpacity
            style={styles.scopeChip}
            onPress={() => selectMode(DEFAULT_MARKET_MODE)}
            accessibilityLabel={t('market.filters.clearScope')}
            testID="market-scope-chip-clear"
            activeOpacity={0.7}
          >
            <Text style={styles.scopeChipText}>{t('market.filters.friendsChip')}</Text>
            <X size={14} color={colors.brandPink} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
      ) : null}

      {
        <View style={styles.liveStatus}>
          <Text style={styles.liveStatusText} testID="market-live-status">
            {t(marketLoadingStatus(live.loading, live.incomplete, baseProducts.length, mode))}
          </Text>
          <TouchableOpacity
            onPress={live.refresh}
            disabled={live.loading}
            accessibilityState={{ disabled: live.loading }}
            accessibilityLabel={t('market.live.refresh')}
            testID="market-live-refresh"
          >
            <Text style={styles.liveStatusText}>{t('market.live.refresh')}</Text>
          </TouchableOpacity>
        </View>
      }
      <MarketFilterBar
        mode={mode}
        onSelectMode={selectMode}
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
        active={panelFilterCount > 0}
        onClear={clearFilters}
      />

      <FlatList
        data={products}
        refreshing={live.loading}
        onRefresh={live.refresh}
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
