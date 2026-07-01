import React, { useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketFilterBarStyles } from '../styles/MarketFilterBar.styles';
import { vendorSlug } from '../utils/marketVendors';

interface Props {
  /** Immediate search text (the screen debounces it before filtering). */
  query: string;
  onChangeQuery: (text: string) => void;
  /** Distinct merchants present in the data; `null` selection means "All". */
  merchants: string[];
  selectedMerchant: string | null;
  onSelectMerchant: (merchant: string | null) => void;
  /** Distinct countries present in the data; `null` selection means "All". */
  countries: string[];
  selectedCountry: string | null;
  onSelectCountry: (country: string | null) => void;
  /** Distinct currencies present in the data; `null` selection means "All". */
  currencies: string[];
  selectedCurrency: string | null;
  onSelectCurrency: (currency: string | null) => void;
  /** Whether any filter axis is active — shows the Clear affordance. */
  active: boolean;
  onClear: () => void;
}

/** A single selectable filter chip. */
const Chip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  styles: ReturnType<typeof createMarketFilterBarStyles>;
}> = ({ label, selected, onPress, testID, styles }) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
    accessibilityState={{ selected }}
    accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
    testID={testID}
    activeOpacity={0.7}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

/**
 * Search + merchant + country + currency filter bar for the Market screen.
 *
 * The search input is controlled (the screen owns the debounce); the merchant,
 * country and currency chip rows are sourced from the DISTINCT values present
 * in the loaded products (passed in by the screen) rather than hardcoded, so
 * they stay correct as the catalogue changes. Each row leads with an "All" chip
 * that clears that axis. A "Clear" pill resets every axis at once and only
 * shows while a filter is active.
 *
 * Presentational only — no filtering logic lives here (that's the pure
 * `utils/marketFilters` module); this just renders controls and reports
 * selections up.
 */
const MarketFilterBar: React.FC<Props> = ({
  query,
  onChangeQuery,
  merchants,
  selectedMerchant,
  onSelectMerchant,
  countries,
  selectedCountry,
  onSelectCountry,
  currencies,
  selectedCurrency,
  onSelectCurrency,
  active,
  onClear,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketFilterBarStyles(colors), [colors]);

  return (
    <View style={styles.container} testID="market-filter-bar">
      {/* Search */}
      <View style={styles.searchRow}>
        <Search size={16} color={colors.textSupplementary} strokeWidth={2.25} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search products or sellers"
          placeholderTextColor={colors.textSupplementary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          testID="market-search-input"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            onPress={() => onChangeQuery('')}
            accessibilityLabel="Clear search"
            testID="market-search-clear"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={16} color={colors.textSupplementary} strokeWidth={2.25} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Merchant chips */}
      {merchants.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}
          testID="market-filter-merchants"
        >
          <Text style={styles.rowLabel}>Merchant</Text>
          <Chip
            label="All"
            selected={selectedMerchant === null}
            onPress={() => onSelectMerchant(null)}
            testID="market-filter-merchant-all"
            styles={styles}
          />
          {merchants.map((m) => (
            <Chip
              key={m}
              label={m}
              selected={selectedMerchant === m}
              onPress={() => onSelectMerchant(selectedMerchant === m ? null : m)}
              // Slugify the merchant name so the testID has no spaces (e.g.
              // "Danish Bacon" -> "danish-bacon"), keeping Maestro selectors
              // stable — matching the codebase's filter-chip convention.
              testID={`market-filter-merchant-${vendorSlug(m)}`}
              styles={styles}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Country chips */}
      {countries.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}
          testID="market-filter-countries"
        >
          <Text style={styles.rowLabel}>Country</Text>
          <Chip
            label="All"
            selected={selectedCountry === null}
            onPress={() => onSelectCountry(null)}
            testID="market-filter-country-all"
            styles={styles}
          />
          {countries.map((c) => (
            <Chip
              key={c}
              label={c}
              selected={selectedCountry === c}
              onPress={() => onSelectCountry(selectedCountry === c ? null : c)}
              // Slugify the country so the testID has no spaces (e.g.
              // "United Kingdom" -> "united-kingdom"), keeping Maestro
              // selectors stable — matching the codebase's filter-chip
              // convention (per Copilot review on #948).
              testID={`market-filter-country-${vendorSlug(c)}`}
              styles={styles}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Currency chips */}
      {currencies.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}
          testID="market-filter-currencies"
        >
          <Text style={styles.rowLabel}>Currency</Text>
          <Chip
            label="All"
            selected={selectedCurrency === null}
            onPress={() => onSelectCurrency(null)}
            testID="market-filter-currency-all"
            styles={styles}
          />
          {currencies.map((cur) => (
            <Chip
              key={cur}
              label={cur}
              selected={selectedCurrency === cur}
              onPress={() => onSelectCurrency(selectedCurrency === cur ? null : cur)}
              testID={`market-filter-currency-${cur}`}
              styles={styles}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Clear-all affordance */}
      {active ? (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={onClear}
          accessibilityLabel="Clear all filters"
          testID="market-filter-clear"
          activeOpacity={0.7}
        >
          <X size={13} color={colors.brandPink} strokeWidth={2.5} />
          <Text style={styles.clearText}>Clear filters</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export default MarketFilterBar;
