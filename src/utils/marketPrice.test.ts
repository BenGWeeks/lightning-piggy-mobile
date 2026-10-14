import {
  convertedPrice,
  formatPrimaryPrice,
  formatSatsNumber,
  listingRateCurrency,
  marketPriceOf,
} from './marketPrice';
import type { MarketProduct } from '../data/marketProducts';

const satsLabel = (amount: string) => `${amount} sats`;

/** A listing-backed product with the parser's fields. */
function listed(
  amount: number | undefined,
  currency: string,
  priceSats = 0,
  recurrence = '',
): Pick<MarketProduct, 'listing' | 'priceSats'> {
  return {
    priceSats,
    listing: {
      currency,
      amount,
      recurrence,
      priceLabel: `${amount} ${currency}${recurrence}`,
    } as MarketProduct['listing'],
  };
}

const rates = (
  userCurrency: string,
  userBtcPrice: number | null,
  listingBtcPrice: number | null = null,
) => ({ userCurrency, userBtcPrice, listingBtcPrice });

describe('formatPrimaryPrice', () => {
  const primary = (p: Pick<MarketProduct, 'listing' | 'priceSats'>, locale = 'en-GB') =>
    formatPrimaryPrice(marketPriceOf(p), satsLabel, locale);

  it('groups sats with locale separators and normalises SAT/SATS/sat', () => {
    expect(primary(listed(500000, 'SATS', 500000))).toBe('500,000 sats');
    expect(primary(listed(500000, 'SAT', 500000))).toBe('500,000 sats');
    expect(primary(listed(500000, 'sat', 500000))).toBe('500,000 sats');
    expect(primary(listed(500000, 'SATS', 500000), 'de-DE')).toBe('500.000 sats');
  });

  it('formats fiat with the locale currency formatter', () => {
    expect(primary(listed(60, 'GBP'))).toBe('£60.00');
    expect(primary(listed(12.5, 'eur'))).toBe('€12.50');
  });

  it('keeps BTC precision and the billing period', () => {
    expect(primary(listed(0.00001, 'BTC', 1000, '/month'))).toBe('0.00001 BTC/month');
    expect(primary(listed(10, 'USD', 0, '/month'), 'en-US')).toBe('$10.00/month');
  });

  it('shows non-ISO units (msat) as-is and falls back to the label without an amount', () => {
    expect(primary(listed(21000, 'MSAT'))).toBe('21,000 MSAT');
    const noAmount = {
      priceSats: 0,
      listing: { currency: 'GBP', priceLabel: '60.00 GBP' } as MarketProduct['listing'],
    };
    expect(primary(noAmount)).toBe('60.00 GBP');
  });

  it('prices curated products (no listing) in sats', () => {
    expect(primary({ priceSats: 75000 })).toBe('75,000 sats');
  });

  it('formatSatsNumber rounds to whole sats', () => {
    expect(formatSatsNumber(1234.6, 'en-US')).toBe('1,235');
  });
});

describe('convertedPrice', () => {
  const convert = (p: Pick<MarketProduct, 'listing' | 'priceSats'>, r: ReturnType<typeof rates>) =>
    convertedPrice(marketPriceOf(p), r, 'en-GB');

  it('sats listing → user fiat', () => {
    // 500,000 sats at £63,040/BTC = £315.20
    expect(convert(listed(500000, 'SATS', 500000), rates('GBP', 63040))).toEqual({
      fiat: '£315.20',
      sats: null,
    });
    expect(convert({ priceSats: 500000 }, rates('GBP', 63040))?.fiat).toBe('£315.20');
  });

  it('fiat listing in the user currency → sats only', () => {
    // £60 at £80,000/BTC = 75,000 sats
    expect(convert(listed(60, 'GBP'), rates('GBP', 80000))).toEqual({ fiat: null, sats: 75000 });
  });

  it('fiat listing in another currency → user fiat and sats', () => {
    // $60 at $100,000/BTC = 60,000 sats; at £80,000/BTC that's £48.00
    expect(convert(listed(60, 'USD'), rates('GBP', 80000, 100000))).toEqual({
      fiat: '£48.00',
      sats: 60000,
    });
    // User-currency rate missing → sats alone.
    expect(convert(listed(60, 'USD'), rates('GBP', null, 100000))).toEqual({
      fiat: null,
      sats: 60000,
    });
  });

  it('renders nothing until the needed rate is loaded', () => {
    expect(convert(listed(500000, 'SATS', 500000), rates('GBP', null))).toBeNull();
    expect(convert(listed(60, 'GBP'), rates('GBP', null))).toBeNull();
    expect(convert(listed(60, 'USD'), rates('GBP', 80000, null))).toBeNull();
  });

  it('renders nothing for msat, unknown currencies and zero prices', () => {
    expect(convert(listed(21000, 'MSAT'), rates('GBP', 80000, 80000))).toBeNull();
    expect(convert(listed(5, 'XYZ'), rates('GBP', 80000, 80000))).toBeNull();
    expect(convert(listed(0, 'SATS', 0), rates('GBP', 80000))).toBeNull();
    expect(convert(listed(undefined, 'GBP'), rates('GBP', 80000))).toBeNull();
  });
});

describe('listingRateCurrency', () => {
  const need = (p: Pick<MarketProduct, 'listing' | 'priceSats'>, user = 'GBP') =>
    listingRateCurrency(marketPriceOf(p), user);

  it('asks for a separate rate only for convertible fiat in another currency', () => {
    expect(need(listed(60, 'usd'))).toBe('USD');
    expect(need(listed(60, 'GBP'))).toBeNull();
    expect(need(listed(500000, 'SATS', 500000))).toBeNull();
    expect(need(listed(21000, 'MSAT'))).toBeNull();
    expect(need(listed(5, 'XYZ'))).toBeNull();
    expect(need(listed(0, 'USD'))).toBeNull();
  });
});
