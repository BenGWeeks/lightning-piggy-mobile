import React, { useCallback, useState } from 'react';
import { Switch, Text, TouchableOpacity, View } from 'react-native';
import { useLocale } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { localizedCountryName } from '../data/countries';
import CountryPickerSheet from './CountryPickerSheet';
import type { MarketFilterBarStyles } from '../styles/MarketFilterBar.styles';

interface ChipProps {
  /** ISO 3166-1 alpha-2, or null for the Anywhere chip. */
  code: string | null;
  label: string;
  selected: boolean;
  onSelect: (code: string | null) => void;
  styles: MarketFilterBarStyles;
}

const ShipsToChip = React.memo(function ShipsToChip({
  code,
  label,
  selected,
  onSelect,
  styles,
}: ChipProps) {
  const { t } = useLocale();
  // Tapping the selected country clears back to Anywhere.
  const choose = useCallback(() => onSelect(selected ? null : code), [onSelect, selected, code]);
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={choose}
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? t('market.filters.chipSelected', { label }) : label}
      testID={`market-filter-shipsto-${code ?? 'anywhere'}`}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
});

/**
 * "Ships to" section of the Market filter panel. Anywhere leads the bounded
 * quick chips from `shipsToOptions`: phone region, selected destination, then
 * up to six popular seller-published countries.
 * More countries opens the shared checkout picker. With a country picked,
 * a toggle decides whether listings without shipping info stay.
 */
export default function MarketShipsToFilter({
  countries,
  selected,
  onSelect,
  includeUnknown,
  onIncludeUnknownChange,
  styles,
}: {
  countries: readonly string[];
  selected: string | null;
  onSelect: (code: string | null) => void;
  includeUnknown: boolean;
  onIncludeUnknownChange: (include: boolean) => void;
  styles: MarketFilterBarStyles;
}) {
  const colors = useThemeColors();
  const { t, locale } = useLocale();
  const [pickerVisible, setPickerVisible] = useState(false);
  const openPicker = useCallback(() => setPickerVisible(true), []);
  const closePicker = useCallback(() => setPickerVisible(false), []);
  return (
    <View style={styles.section} testID="market-filter-shipsto">
      <Text style={styles.sectionLabel}>{t('market.filters.shipsTo')}</Text>
      <View style={styles.chipWrap}>
        <ShipsToChip
          code={null}
          label={t('market.filters.anywhere')}
          selected={selected === null}
          // Anywhere is not a toggle: tapping it always clears the axis.
          onSelect={onSelect}
          styles={styles}
        />
        {countries.map((code) => (
          <ShipsToChip
            key={code}
            code={code}
            label={localizedCountryName(code, locale)}
            selected={selected === code}
            onSelect={onSelect}
            styles={styles}
          />
        ))}
        <TouchableOpacity
          style={styles.chip}
          onPress={openPicker}
          accessibilityRole="button"
          accessibilityLabel={t('market.filters.moreCountries')}
          testID="market-filter-shipsto-more"
          activeOpacity={0.7}
        >
          <Text style={styles.chipText}>{t('market.filters.moreCountries')}</Text>
        </TouchableOpacity>
      </View>
      <CountryPickerSheet
        visible={pickerVisible}
        onClose={closePicker}
        selectedCode={selected}
        onSelect={onSelect}
      />
      {selected !== null ? (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{t('market.filters.includeUnknownShipping')}</Text>
          <Switch
            value={includeUnknown}
            onValueChange={onIncludeUnknownChange}
            trackColor={{ true: colors.brandPink, false: colors.divider }}
            thumbColor={colors.white}
            accessibilityLabel={t('market.filters.includeUnknownShipping')}
            testID="market-filter-shipsto-include-unknown"
          />
        </View>
      ) : null}
    </View>
  );
}
