import React from 'react';
import { View, Text, TextInput, Switch } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { countryName } from '../data/countries';
import type { ShippingOption } from '../utils/marketShipping';
import { formatMarketAmount } from '../utils/marketListingShipping';
import type { ListingShippingDraft } from '../utils/marketSellerEvents';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

interface Props {
  zones: ShippingOption[];
  value: ListingShippingDraft[];
  /** The listing's currency — the spec prices the per-item extra in it. */
  currency: string;
  showErrors: boolean;
  onChange: (value: ListingShippingDraft[]) => void;
  styles: MarketSellerStyles;
}

function regionLabel(zone: ShippingOption, worldwide: string): string {
  if (zone.countries.length === 0) return worldwide;
  const names = zone.countries.slice(0, 3).map(countryName).join(', ');
  return zone.countries.length > 3 ? `${names} +${zone.countries.length - 3}` : names;
}

/** Pick which of the shop's shipping zones this listing uses, each with an
 * optional per-item extra cost. */
const ListingShippingPicker: React.FC<Props> = ({
  zones,
  value,
  currency,
  showErrors,
  onChange,
  styles,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  if (zones.length === 0) {
    return <Text style={styles.muted}>{t('market.sell.editor.noZones')}</Text>;
  }
  return (
    <View style={styles.field}>
      {zones.map((zone, index) => {
        const selected = value.find((v) => v.coordinate === zone.coordinate);
        const extraError =
          showErrors &&
          !!selected?.extraCost.trim() &&
          !/^\d+([.,]\d+)?$/.test(selected.extraCost.trim());
        const toggle = (on: boolean) =>
          onChange(
            on
              ? [...value, { coordinate: zone.coordinate, extraCost: '' }]
              : value.filter((v) => v.coordinate !== zone.coordinate),
          );
        return (
          <View
            key={zone.coordinate}
            style={[styles.shipRow, selected && styles.shipRowSelected]}
            testID={`listing-ship-zone-${index}`}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.shipTitle}>{zone.title}</Text>
              <Switch
                value={!!selected}
                onValueChange={toggle}
                trackColor={{ true: colors.brandPink, false: colors.divider }}
                thumbColor={colors.white}
                accessibilityLabel={t('market.sell.editor.toggleZone', { name: zone.title })}
                testID={`listing-ship-toggle-${index}`}
              />
            </View>
            <Text style={styles.muted}>
              {t('market.sell.editor.zoneBase', {
                amount: formatMarketAmount(zone.baseAmount, zone.currency),
                currency: zone.currency,
              })}{' '}
              · {regionLabel(zone, t('market.sell.zone.worldwide'))}
            </Text>
            {selected ? (
              <View style={styles.field}>
                <Text style={styles.hint}>{t('market.sell.editor.extraCost', { currency })}</Text>
                <TextInput
                  style={[styles.input, extraError && styles.inputError]}
                  value={selected.extraCost}
                  onChangeText={(extraCost) =>
                    onChange(
                      value.map((v) =>
                        v.coordinate === zone.coordinate ? { ...v, extraCost } : v,
                      ),
                    )
                  }
                  placeholder={t('market.sell.editor.extraCostPlaceholder')}
                  placeholderTextColor={colors.textSupplementary}
                  keyboardType="decimal-pad"
                  maxLength={16}
                  testID={`listing-ship-extra-${index}`}
                  accessibilityLabel={t('market.sell.editor.extraCost', { currency })}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

export default React.memo(ListingShippingPicker);
