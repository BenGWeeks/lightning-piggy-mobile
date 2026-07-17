import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetFlatList,
  BottomSheetTextInput,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Check } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createCountryPickerSheetStyles } from '../styles/CountryPickerSheet.styles';
import { COUNTRIES, type Country } from '../data/countries';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Currently selected ISO 3166-1 alpha-2 code, or null. */
  selectedCode: string | null;
  /** Fired with the picked code; the sheet closes itself after. */
  onSelect: (code: string) => void;
}

/**
 * Searchable "Ship to" country picker for the Market checkout (#948 Option A).
 * A validated ISO 3166-1 list — never free text — so the picked CODE matches
 * kind-30406 `country` tags exactly. Same BottomSheetFlatList + search
 * pattern as CreateGroupSheet (long list → 85% snap).
 */
const CountryPickerSheet: React.FC<Props> = ({ visible, onClose, selectedCode, onSelect }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createCountryPickerSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [search, setSearch] = useState('');
  // Defer the filter so Android's IME never races the per-keystroke re-render
  // (same rationale as CreateGroupSheet / FriendPickerSheet).
  const deferredSearch = useDeferredValue(search);
  const snapPoints = useMemo(() => ['85%'], []);

  useEffect(() => {
    if (visible) {
      setSearch('');
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  }, [deferredSearch]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handlePick = useCallback(
    (code: string) => {
      onSelect(code);
      onClose();
    },
    [onSelect, onClose],
  );

  const renderItem = useCallback(
    ({ item }: { item: Country }) => {
      const isSelected = item.code === selectedCode;
      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() => handlePick(item.code)}
          accessibilityRole="button"
          accessibilityLabel={t('market.shipping.shipToCountry', { country: item.name })}
          testID={`country-picker-row-${item.code}`}
        >
          <Text style={[styles.rowName, isSelected && styles.rowNameSelected]} numberOfLines={1}>
            {item.name}
          </Text>
          {isSelected ? (
            <Check size={18} color={colors.brandPink} strokeWidth={3} />
          ) : (
            <Text style={styles.rowCode}>{item.code}</Text>
          )}
        </TouchableOpacity>
      );
    },
    [styles, colors, selectedCode, handlePick, t],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      keyboardBehavior="interactive"
      // Stack ABOVE the checkout modal — the default "replace" would dismiss
      // the checkout sheet the moment this picker presents.
      stackBehavior="push"
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      onDismiss={onClose}
    >
      <View style={styles.container} testID="country-picker-sheet">
        <Text style={styles.title}>{t('market.shipping.shipToTitle')}</Text>
        <BottomSheetTextInput
          style={styles.searchInput}
          placeholder={t('market.shipping.searchCountriesPlaceholder')}
          placeholderTextColor={colors.textSupplementary}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t('market.shipping.searchCountries')}
          testID="country-picker-search"
        />
        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(item: Country) => item.code}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {t('market.shipping.noCountriesMatch', { query: deferredSearch.trim() })}
              </Text>
            </View>
          }
        />
      </View>
    </BottomSheetModal>
  );
};

export default CountryPickerSheet;
