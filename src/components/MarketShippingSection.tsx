import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ChevronRight, Globe, MessageCircle } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketShippingSectionStyles } from '../styles/MarketShippingSection.styles';
import { countryName } from '../data/countries';
import type { ShippingOption } from '../utils/marketShipping';

interface Props {
  /** Fetch state from useShippingOptions. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  retry: () => void;
  /** Options already filtered to the selected country (empty = no match). */
  compatibleOptions: ShippingOption[];
  /** Selected destination (ISO 3166-1 alpha-2), or null before the pick. */
  countryCode: string | null;
  onOpenCountryPicker: () => void;
  /** Coordinate of the chosen option, or null. */
  selectedCoordinate: string | null;
  onSelectOption: (coordinate: string) => void;
  /** All-in sats cost per option coordinate; null = fiat rate unavailable. */
  costSatsByCoordinate: Map<string, number | null>;
  sellerName: string;
  onMessageShop: () => void;
}

/** "Ships worldwide" vs a short country list for an option row's sub-label. */
function scopeLabel(option: ShippingOption): string {
  if (option.countries.length === 0) return 'Ships worldwide';
  const names = option.countries.slice(0, 3).map(countryName);
  const more = option.countries.length - names.length;
  return `Ships to ${names.join(', ')}${more > 0 ? ` +${more}` : ''}`;
}

/**
 * Country-first shipping selection inside the Market checkout (#948 Option A):
 * a required "Ship to" country row, then only the merchant's kind-30406
 * options compatible with that country. Zero matches renders an honest empty
 * state with a "Message the shop" affordance instead of letting the buyer
 * place an unshippable order.
 */
const MarketShippingSection: React.FC<Props> = ({
  status,
  retry,
  compatibleOptions,
  countryCode,
  onOpenCountryPicker,
  selectedCoordinate,
  onSelectOption,
  costSatsByCoordinate,
  sellerName,
  onMessageShop,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketShippingSectionStyles(colors), [colors]);

  if (status === 'loading') {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Shipping</Text>
        <View style={styles.statusRow} testID="market-shipping-loading">
          <ActivityIndicator size="small" color={colors.brandPink} />
          <Text style={styles.statusText}>Checking where {sellerName} ships…</Text>
        </View>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Shipping</Text>
        <View style={styles.statusRow} testID="market-shipping-error">
          <Text style={styles.statusText}>Couldn&apos;t load shipping options.</Text>
          <TouchableOpacity
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading shipping options"
            testID="market-shipping-retry"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Shipping</Text>

      <TouchableOpacity
        style={styles.countryRow}
        onPress={onOpenCountryPicker}
        accessibilityRole="button"
        accessibilityLabel={
          countryCode ? `Ship to ${countryName(countryCode)} — change country` : 'Choose country'
        }
        testID="market-shipping-country"
      >
        {countryCode ? (
          <Text style={styles.countryLabel}>{countryName(countryCode)}</Text>
        ) : (
          <Text style={styles.countryPlaceholder}>Choose country…</Text>
        )}
        <View style={styles.countryChevronWrap}>
          <Globe size={16} color={colors.textSupplementary} strokeWidth={2} />
          <ChevronRight size={16} color={colors.textSupplementary} strokeWidth={2.5} />
        </View>
      </TouchableOpacity>

      {countryCode ? (
        compatibleOptions.length === 0 ? (
          <View style={styles.emptyWrap} testID="market-shipping-empty">
            <Text style={styles.emptyText}>
              We don&apos;t ship to {countryName(countryCode)} yet — message the shop and ask.
            </Text>
            <TouchableOpacity
              style={styles.messageShopButton}
              onPress={onMessageShop}
              accessibilityRole="button"
              accessibilityLabel={`Message ${sellerName}`}
              testID="market-shipping-message-shop"
            >
              <MessageCircle size={15} color={colors.brandPink} strokeWidth={2.5} />
              <Text style={styles.messageShopText}>Message {sellerName}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          compatibleOptions.map((option) => {
            const isSelected = option.coordinate === selectedCoordinate;
            const costSats = costSatsByCoordinate.get(option.coordinate);
            return (
              <TouchableOpacity
                key={option.coordinate}
                style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                onPress={() => onSelectOption(option.coordinate)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Shipping option ${option.title}`}
                testID={`market-shipping-option-${option.dTag}`}
              >
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle} numberOfLines={1}>
                    {option.title}
                  </Text>
                  <Text style={styles.optionScope} numberOfLines={1}>
                    {scopeLabel(option)}
                  </Text>
                </View>
                <Text style={styles.optionCost}>
                  {costSats === null || costSats === undefined
                    ? // Fiat rate unavailable — show the merchant's own pricing
                      // rather than a wrong sats figure; submit stays blocked.
                      `${option.baseAmount} ${option.currency || '?'}`
                    : costSats === 0
                      ? 'Free'
                      : `${costSats.toLocaleString()} sats`}
                </Text>
              </TouchableOpacity>
            );
          })
        )
      ) : null}
    </View>
  );
};

export default MarketShippingSection;
