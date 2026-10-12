import React, { useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Plus, Trash2, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { countryName } from '../data/countries';
import {
  SHIPPING_REGION_PRESETS,
  type ShippingRegionPreset,
  type ShippingZoneDraft,
} from '../utils/marketSellerEvents';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

interface Props {
  zone: ShippingZoneDraft;
  index: number;
  currency: string;
  showErrors: boolean;
  styles: MarketSellerStyles;
  onChange: (index: number, zone: ShippingZoneDraft) => void;
  onRemove: (index: number) => void;
  onAddCountry: (index: number) => void;
}

const PRESETS: { id: ShippingRegionPreset; labelKey: string }[] = [
  { id: 'worldwide', labelKey: 'market.sell.zone.presetWorldwide' },
  { id: 'uk', labelKey: 'market.sell.zone.presetUk' },
  { id: 'eu', labelKey: 'market.sell.zone.presetEu' },
  { id: 'northAmerica', labelKey: 'market.sell.zone.presetNorthAmerica' },
];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((c) => b.includes(c));

/** Edit one shipping zone (a kind-30406 option): name, cost, where it ships. */
const ShippingZoneEditor: React.FC<Props> = ({
  zone,
  index,
  currency,
  showErrors,
  styles,
  onChange,
  onRemove,
  onAddCountry,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const update = useCallback(
    (patch: Partial<ShippingZoneDraft>) => onChange(index, { ...zone, ...patch }),
    [index, zone, onChange],
  );
  // A zone that exactly matches a preset shows just the highlighted preset;
  // anything else lists its countries (EU alone would be 27 chips).
  const matchedPreset = PRESETS.find((p) => sameSet(zone.countries, SHIPPING_REGION_PRESETS[p.id]));
  const nameError = showErrors && !zone.name.trim();
  const costError = showErrors && !/^\d+([.,]\d+)?$/.test(zone.cost.trim());

  return (
    <View style={styles.zoneCard} testID={`shop-zone-${index}`}>
      <View style={styles.zoneRow}>
        <View style={[styles.field, styles.zoneName]}>
          <Text style={styles.label}>{t('market.sell.zone.name')}</Text>
          <TextInput
            style={[styles.input, nameError && styles.inputError]}
            value={zone.name}
            onChangeText={(name) => update({ name })}
            placeholder={t('market.sell.zone.namePlaceholder')}
            placeholderTextColor={colors.textSupplementary}
            maxLength={100}
            testID={`shop-zone-name-${index}`}
            accessibilityLabel={t('market.sell.zone.name')}
          />
        </View>
        <View style={[styles.field, styles.zoneCost]}>
          <Text style={styles.label}>{t('market.sell.zone.cost', { currency })}</Text>
          <TextInput
            style={[styles.input, costError && styles.inputError]}
            value={zone.cost}
            onChangeText={(cost) => update({ cost })}
            placeholder="0"
            placeholderTextColor={colors.textSupplementary}
            keyboardType="decimal-pad"
            maxLength={16}
            testID={`shop-zone-cost-${index}`}
            accessibilityLabel={t('market.sell.zone.cost', { currency })}
          />
        </View>
      </View>

      <Text style={styles.label}>{t('market.sell.zone.regions')}</Text>
      <View style={styles.chipRow}>
        {PRESETS.map((preset) => {
          const selected = matchedPreset?.id === preset.id;
          return (
            <TouchableOpacity
              key={preset.id}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => update({ countries: [...SHIPPING_REGION_PRESETS[preset.id]] })}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(preset.labelKey)}
              testID={`shop-zone-preset-${preset.id}-${index}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {t(preset.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {matchedPreset ? null : (
        <View style={styles.chipRow}>
          {zone.countries.map((code) => (
            <TouchableOpacity
              key={code}
              style={[styles.chip, styles.chipSelected]}
              onPress={() => update({ countries: zone.countries.filter((c) => c !== code) })}
              accessibilityLabel={t('market.sell.zone.removeCountry', {
                country: countryName(code),
              })}
              testID={`shop-zone-country-${code}-${index}`}
            >
              <Text style={[styles.chipText, styles.chipTextSelected]}>{countryName(code)}</Text>
              <X size={14} color={colors.brandPink} strokeWidth={2.5} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.rowBetween}>
        <TouchableOpacity
          style={styles.chip}
          onPress={() => onAddCountry(index)}
          accessibilityLabel={t('market.sell.zone.addCountry')}
          testID={`shop-zone-add-country-${index}`}
        >
          <Plus size={14} color={colors.textBody} strokeWidth={2.5} />
          <Text style={styles.chipText}>{t('market.sell.zone.addCountry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onRemove(index)}
          accessibilityLabel={t('market.sell.zone.remove')}
          testID={`shop-zone-remove-${index}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Trash2 size={20} color={colors.red} strokeWidth={2.25} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default React.memo(ShippingZoneEditor);
