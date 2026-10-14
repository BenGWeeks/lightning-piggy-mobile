import React, { useCallback, useMemo } from 'react';
import { View, Text } from 'react-native';
import { Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
import { useListingBtcPrice } from '../hooks/useListingBtcPrice';
import { createMarketPriceStyles } from '../styles/MarketPrice.styles';
import {
  convertedPrice,
  formatPrimaryPrice,
  formatSatsNumber,
  listingRateCurrency,
  marketPriceOf,
} from '../utils/marketPrice';
import type { MarketProduct } from '../data/marketProducts';

interface Props {
  product: Pick<MarketProduct, 'listing' | 'priceSats'>;
  /** `detail` — product page; `compact` — grid / rail card. */
  variant: 'detail' | 'compact';
  /** testID base: renders `<base>-primary` and `<base>-converted`. */
  testIDPrefix?: string;
}

/**
 * A Market listing's price: its own price formatted properly ("500,000 sats",
 * "£60.00"), with the "≈" conversion into the user's display currency
 * underneath. Rates come from the wallet's shared BTC price (plus one shared
 * fetch per foreign listing currency) — nothing per card.
 */
const MarketPrice: React.FC<Props> = ({ product, variant, testIDPrefix = 'market-price' }) => {
  const colors = useThemeColors();
  const { t, formatLocale } = useLocale();
  const { currency } = useWallet();
  const { btcPrice } = useWalletLive();
  const styles = useMemo(() => createMarketPriceStyles(colors), [colors]);
  const compact = variant === 'compact';

  const { listing, priceSats } = product;
  const price = useMemo(() => marketPriceOf({ listing, priceSats }), [listing, priceSats]);
  const satsLabel = useCallback((amount: string) => t('market.sats', { amount }), [t]);
  const primary = useMemo(
    () => formatPrimaryPrice(price, satsLabel, formatLocale),
    [price, satsLabel, formatLocale],
  );
  const listingBtcPrice = useListingBtcPrice(listingRateCurrency(price, currency));
  const secondary = useMemo(() => {
    const converted = convertedPrice(
      price,
      { userCurrency: currency, userBtcPrice: btcPrice, listingBtcPrice },
      formatLocale,
    );
    if (!converted) return null;
    const sats =
      converted.sats !== null ? satsLabel(formatSatsNumber(converted.sats, formatLocale)) : null;
    // Cards keep the one value that matters most to the user: their own fiat.
    if (converted.fiat && sats && !compact) {
      return t('market.priceApproxBoth', { fiat: converted.fiat, sats });
    }
    return t('market.priceApprox', { value: converted.fiat ?? sats });
  }, [price, currency, btcPrice, listingBtcPrice, formatLocale, satsLabel, compact, t]);

  return (
    <View>
      <View
        style={[styles.primaryRow, compact ? styles.compactPrimaryRow : styles.detailPrimaryRow]}
      >
        <Zap
          size={compact ? 12 : 16}
          color={colors.brandPink}
          strokeWidth={2.5}
          fill={colors.brandPink}
        />
        <Text
          style={compact ? styles.compactPrimary : styles.detailPrimary}
          numberOfLines={compact ? 1 : undefined}
          testID={`${testIDPrefix}-primary`}
        >
          {primary}
        </Text>
      </View>
      {compact ? (
        <View style={styles.compactConvertedSlot}>
          {secondary ? (
            <Text
              style={styles.compactConverted}
              numberOfLines={1}
              testID={`${testIDPrefix}-converted`}
            >
              {secondary}
            </Text>
          ) : null}
        </View>
      ) : secondary ? (
        <Text style={styles.detailConverted} testID={`${testIDPrefix}-converted`}>
          {secondary}
        </Text>
      ) : null}
    </View>
  );
};

export default React.memo(MarketPrice);
