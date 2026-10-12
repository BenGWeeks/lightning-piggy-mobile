import React from 'react';
import { ScrollView, Text, TouchableOpacity } from 'react-native';
import { SELLER_CURRENCIES } from '../utils/marketSellerEvents';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

interface Props {
  value: string;
  onChange: (currency: string) => void;
  styles: MarketSellerStyles;
  testIDPrefix: string;
}

/** Horizontal chip picker over the (bounded) seller currency list. */
const SellerCurrencyChips: React.FC<Props> = ({ value, onChange, styles, testIDPrefix }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.chipScroll}
    keyboardShouldPersistTaps="handled"
  >
    {SELLER_CURRENCIES.map((currency) => {
      const selected = currency === value.toUpperCase();
      return (
        <TouchableOpacity
          key={currency}
          style={[styles.chip, selected && styles.chipSelected]}
          onPress={() => onChange(currency)}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={currency}
          testID={`${testIDPrefix}-${currency}`}
        >
          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{currency}</Text>
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

export default React.memo(SellerCurrencyChips);
