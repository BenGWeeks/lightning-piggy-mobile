import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Package, Truck } from 'lucide-react-native';
import type { Event } from 'nostr-tools';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { countryName } from '../data/countries';
import { useListingShippingQuotes } from '../hooks/useListingShippingQuotes';
import {
  formatMarketAmount,
  listingCategories,
  listingStock,
} from '../utils/marketListingShipping';
import { createMarketListingDetailsStyles } from '../styles/MarketListingDetails.styles';

interface Props {
  event: Event;
  currency: string;
}

/** Stock, categories and shipping options of a relay listing, as shoppers
 * see them on the product page. */
const MarketListingDetails: React.FC<Props> = ({ event, currency }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketListingDetailsStyles(colors), [colors]);
  const stock = useMemo(() => listingStock(event), [event]);
  const categories = useMemo(() => listingCategories(event), [event]);
  const shipping = useListingShippingQuotes(event, currency);

  return (
    <View style={styles.container} testID="market-listing-details">
      {stock !== null ? (
        <View style={styles.row}>
          <Package size={16} color={colors.textSupplementary} strokeWidth={2.25} />
          <Text style={styles.text} testID="market-listing-stock">
            {t('market.sell.detail.inStock', { count: stock })}
          </Text>
        </View>
      ) : null}
      {categories.length > 0 ? (
        <View style={styles.chips}>
          {categories.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>#{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {shipping.status === 'ready' && shipping.quotes.length === 0 ? (
        // Referenced options that aren't published (or don't parse): no empty card.
        <View style={styles.row} testID="market-listing-shipping-contact">
          <Truck size={16} color={colors.textSupplementary} strokeWidth={2.25} />
          <Text style={styles.muted}>{t('market.sell.detail.shippingNone')}</Text>
        </View>
      ) : shipping.status !== 'none' ? (
        <View style={styles.shipping} testID="market-listing-shipping">
          <View style={styles.row}>
            <Truck size={16} color={colors.textSupplementary} strokeWidth={2.25} />
            <Text style={styles.heading}>{t('market.sell.detail.shipping')}</Text>
          </View>
          {shipping.status === 'loading' ? (
            <ActivityIndicator color={colors.brandPink} />
          ) : shipping.status === 'error' ? (
            <TouchableOpacity
              onPress={shipping.retry}
              accessibilityLabel={t('market.sell.retry')}
              testID="market-listing-shipping-retry"
            >
              <Text style={styles.error}>{t('market.sell.detail.shippingError')}</Text>
            </TouchableOpacity>
          ) : (
            shipping.quotes.map((q) => (
              <View key={q.option.coordinate} style={styles.quote}>
                <View style={styles.quoteBody}>
                  <Text style={styles.text}>{q.option.title}</Text>
                  <Text style={styles.muted} numberOfLines={2}>
                    {q.option.countries.length === 0
                      ? t('market.sell.zone.worldwide')
                      : q.option.countries.map(countryName).join(', ')}
                  </Text>
                </View>
                <Text style={styles.price}>
                  {q.totalAmount === 0
                    ? t('market.free')
                    : q.totalAmount !== null
                      ? t('market.sell.detail.shippingTotal', {
                          amount: formatMarketAmount(q.totalAmount, q.currency),
                          currency: q.currency,
                        })
                      : t('market.sell.detail.shippingSplit', {
                          amount: formatMarketAmount(q.baseAmount, q.currency),
                          currency: q.currency,
                          extra: formatMarketAmount(q.extraAmount, currency),
                          extraCurrency: currency,
                        })}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
};

export default MarketListingDetails;
