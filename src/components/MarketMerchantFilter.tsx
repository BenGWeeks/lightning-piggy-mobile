import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import {
  createMarketFilterBarStyles,
  type MarketFilterBarStyles,
} from '../styles/MarketFilterBar.styles';
import { collapsedMerchants, type MarketMerchant } from '../utils/marketMerchants';
import { vendorSlug } from '../utils/marketVendors';

const MerchantRow = React.memo(function MerchantRow({
  merchant,
  selected,
  onSelect,
  styles,
}: {
  merchant: MarketMerchant;
  selected: boolean;
  onSelect: (id: string | null) => void;
  styles: MarketFilterBarStyles;
}) {
  const choose = useCallback(
    () => onSelect(selected ? null : merchant.id),
    [onSelect, selected, merchant.id],
  );
  return (
    <TouchableOpacity
      style={[styles.sellerOption, selected && styles.chipSelected]}
      onPress={choose}
      accessibilityState={{ selected }}
      accessibilityLabel={merchant.label}
      testID={`market-merchant-row-${merchant.id}`}
    >
      <Text style={[styles.merchantRowLabel, selected && styles.chipTextSelected]}>
        {merchant.label}
      </Text>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{merchant.count}</Text>
    </TouchableOpacity>
  );
});
const MerchantChip = React.memo(function MerchantChip({
  merchant,
  selected,
  onSelect,
  styles,
}: {
  merchant: MarketMerchant;
  selected: boolean;
  onSelect: (id: string | null) => void;
  styles: MarketFilterBarStyles;
}) {
  const choose = useCallback(
    () => onSelect(selected ? null : merchant.id),
    [onSelect, selected, merchant.id],
  );
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={choose}
      accessibilityState={{ selected }}
      accessibilityLabel={merchant.label}
      testID={`market-filter-merchant-${vendorSlug(merchant.id)}`}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {merchant.label}
      </Text>
    </TouchableOpacity>
  );
});
const keyExtractor = (merchant: MarketMerchant) => merchant.id;

export default function MarketMerchantFilter({
  merchants,
  selected,
  onSelect,
}: {
  merchants: readonly MarketMerchant[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketFilterBarStyles(colors), [colors]);
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const collapsed = useMemo(() => collapsedMerchants(merchants, selected), [merchants, selected]);
  const matches = useMemo(
    () =>
      merchants.filter((merchant) =>
        `${merchant.label} ${merchant.id}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [merchants, query],
  );
  const close = useCallback(() => {
    setExpanded(false);
    setQuery('');
  }, []);
  const choose = useCallback(
    (id: string | null) => {
      onSelect(id);
      close();
    },
    [onSelect, close],
  );
  const renderItem = useCallback(
    ({ item }: { item: MarketMerchant }) => (
      <MerchantRow
        merchant={item}
        selected={selected === item.id}
        onSelect={choose}
        styles={styles}
      />
    ),
    [selected, choose, styles],
  );
  return (
    <View style={styles.section} testID="market-filter-merchants">
      <Text style={styles.sectionLabel}>{t('market.filters.merchant')}</Text>
      <View style={styles.chipWrap}>
        <TouchableOpacity
          style={[styles.chip, selected === null && styles.chipSelected]}
          onPress={() => onSelect(null)}
          testID="market-filter-merchant-all"
          accessibilityLabel={t('market.filters.all')}
          accessibilityState={{ selected: selected === null }}
        >
          <Text style={[styles.chipText, selected === null && styles.chipTextSelected]}>
            {t('market.filters.all')}
          </Text>
        </TouchableOpacity>
        {collapsed.visible.map((merchant) => (
          <MerchantChip
            key={merchant.id}
            merchant={merchant}
            selected={selected === merchant.id}
            onSelect={onSelect}
            styles={styles}
          />
        ))}
        {collapsed.remaining > 0 ? (
          <TouchableOpacity
            style={styles.chip}
            onPress={() => setExpanded(true)}
            testID="market-filter-merchant-more"
            accessibilityLabel={t('market.filters.moreMerchants', { count: collapsed.remaining })}
          >
            <Text style={styles.chipText}>
              {t('market.filters.moreMerchants', { count: collapsed.remaining })}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Modal
        visible={expanded}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.merchantSheetOverlay}>
          <Pressable
            style={styles.backdrop}
            onPress={close}
            accessibilityLabel={t('market.filters.close')}
            testID="market-merchant-list-backdrop"
          />
          <View style={styles.merchantList} testID="market-merchant-list">
            <Text style={styles.merchantListTitle}>{t('market.filters.merchant')}</Text>
            <TextInput
              style={styles.merchantSearch}
              value={query}
              onChangeText={setQuery}
              placeholder={t('market.filters.searchMerchants')}
              placeholderTextColor={colors.textSupplementary}
              accessibilityLabel={t('market.filters.searchMerchants')}
              testID="market-merchant-search"
              autoCorrect={false}
            />
            <FlatList
              data={matches}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.chipText}>{t('market.filters.noMerchants')}</Text>
              }
            />
            <TouchableOpacity
              style={styles.doneButton}
              onPress={close}
              testID="market-merchant-list-close"
              accessibilityLabel={t('market.filters.close')}
            >
              <Text style={styles.doneText}>{t('market.filters.done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
