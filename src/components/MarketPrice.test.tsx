import React from 'react';
import { render } from '@testing-library/react-native';
import MarketPrice from './MarketPrice';
import type { MarketProduct } from '../data/marketProducts';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('lucide-react-native', () => ({ Zap: () => null }));
const templates: Record<string, string> = {
  'market.sats': '{{amount}} sats',
  'market.priceApprox': '≈ {{value}}',
  'market.priceApproxBoth': '≈ {{fiat}} · {{sats}}',
};
jest.mock('../contexts/LocaleContext', () => ({
  useLocale: () => ({
    formatLocale: 'en-GB',
    t: (key: string, params: Record<string, string> = {}) =>
      (templates[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? ''),
  }),
}));
let mockBtcPrice: number | null = 80000;
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({ currency: 'GBP' }),
  useWalletLive: () => ({ btcPrice: mockBtcPrice }),
}));
let mockListingRate: number | null = 100000;
jest.mock('../hooks/useListingBtcPrice', () => ({
  useListingBtcPrice: (currency: string | null) => (currency ? mockListingRate : null),
}));

const listed = (amount: number, currency: string, priceSats = 0) => ({
  priceSats,
  listing: { currency, amount, priceLabel: `${amount} ${currency}` } as MarketProduct['listing'],
});

beforeEach(() => {
  mockBtcPrice = 80000;
  mockListingRate = 100000;
});

it('shows the formatted sats price with the user-fiat conversion underneath', () => {
  const ui = render(<MarketPrice product={listed(500000, 'SATS', 500000)} variant="detail" />);
  expect(ui.getByTestId('market-price-primary')).toHaveTextContent('500,000 sats');
  expect(ui.getByTestId('market-price-converted')).toHaveTextContent('≈ £400.00');
});

it('shows sats for a listing in the user currency', () => {
  const ui = render(<MarketPrice product={listed(60, 'GBP')} variant="detail" />);
  expect(ui.getByTestId('market-price-primary')).toHaveTextContent('£60.00');
  expect(ui.getByTestId('market-price-converted')).toHaveTextContent('≈ 75,000 sats');
});

it('shows user fiat and sats for a foreign-fiat listing; cards keep just the fiat', () => {
  const detail = render(<MarketPrice product={listed(60, 'USD')} variant="detail" />);
  expect(detail.getByTestId('market-price-converted')).toHaveTextContent('≈ £48.00 · 60,000 sats');
  const card = render(
    <MarketPrice product={listed(60, 'USD')} variant="compact" testIDPrefix="card-price" />,
  );
  expect(card.getByTestId('card-price-converted')).toHaveTextContent('≈ £48.00');
});

it('renders no converted line until rates load, or for msat', () => {
  mockBtcPrice = null;
  const ui = render(<MarketPrice product={listed(500000, 'SATS', 500000)} variant="detail" />);
  expect(ui.queryByTestId('market-price-converted')).toBeNull();
  const msat = render(<MarketPrice product={listed(21000, 'MSAT')} variant="compact" />);
  expect(msat.getByTestId('market-price-primary')).toHaveTextContent('21,000 MSAT');
  expect(msat.queryByTestId('market-price-converted')).toBeNull();
});
