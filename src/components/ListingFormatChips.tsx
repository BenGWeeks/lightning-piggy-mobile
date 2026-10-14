import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { ListingFormat } from '../utils/shopSellGate';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

const FORMATS: readonly ListingFormat[] = ['physical', 'digital'];

/** Physical or digital item (the Gamma `type` tag's format). A digital item
 * ships nothing, so it skips shipping and the shipping-options gate. */
function ListingFormatChips({
  value,
  onChange,
  styles,
}: {
  value: ListingFormat;
  onChange: (format: ListingFormat) => void;
  styles: MarketSellerStyles;
}) {
  const t = useTranslation();
  return (
    <View style={styles.field} accessibilityRole="radiogroup">
      <Text style={styles.label}>{t('market.sell.editor.itemType')}</Text>
      <View style={styles.chipRow}>
        {FORMATS.map((format) => {
          const selected = format === value;
          return (
            <TouchableOpacity
              key={format}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onChange(format)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`market.sell.editor.format.${format}`)}
              testID={`listing-format-${format}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {t(`market.sell.editor.format.${format}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>{t(`market.sell.editor.formatHint.${value}`)}</Text>
    </View>
  );
}

export default React.memo(ListingFormatChips);
