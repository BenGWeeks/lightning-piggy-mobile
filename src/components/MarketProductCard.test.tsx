import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'expo-image';
import MarketProductCard from './MarketProductCard';
import { MARKET_PRODUCTS } from '../data/marketProducts';
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({
  useLocale: () => ({
    formatLocale: 'en',
    t: (_key: string, params?: { seller?: string }) => params?.seller ?? _key,
  }),
}));
let mockName: string | null = 'Profile shop';
jest.mock('../hooks/usePubkeyProfile', () => ({ usePubkeyProfile: () => ({ name: mockName }) }));
jest.mock('./VendorAvatar', () => () => null);
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({ currency: 'GBP' }),
  useWalletLive: () => ({ btcPrice: null }),
}));
jest.mock('lucide-react-native', () => ({ Zap: () => null }));
it('prefers the kind-0 seller identity in the visible card and accessibility label', () => {
  const product = {
    ...MARKET_PRODUCTS[0],
    listing: { event: { pubkey: 'seller' }, currency: 'SAT', amount: 21, priceLabel: '21 SAT' },
  } as (typeof MARKET_PRODUCTS)[number];
  const h = render(
    <MarketProductCard
      product={product}
      sellerName="Fallback shop"
      variant="grid"
      onPress={jest.fn()}
      testID="product"
    />,
  );
  expect(h.getByText('Profile shop')).toBeTruthy();
  expect(h.getByTestId('product').props.accessibilityLabel).toContain('Profile shop');
  mockName = null;
  h.rerender(
    <MarketProductCard
      product={product}
      sellerName="Fallback shop"
      variant="grid"
      onPress={jest.fn()}
      testID="product"
    />,
  );
  expect(h.getByText('Fallback shop')).toBeTruthy();
});

it('requires consent before mounting an untrusted remote image', () => {
  const product = { ...MARKET_PRODUCTS[0], image: 'https://tracker.example/pixel' };
  const onPress = jest.fn();
  const h = render(
    <MarketProductCard
      product={product}
      sellerName="Shop"
      variant="list"
      onPress={onPress}
      testID="product"
      autoLoadMedia={false}
    />,
  );
  expect(h.UNSAFE_queryByType(Image)).toBeNull();
  const stopPropagation = jest.fn();
  fireEvent.press(h.getByTestId('product-load-image'), { stopPropagation });
  expect(stopPropagation).toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();
  expect(h.UNSAFE_getByType(Image).props.source.uri).toBe(product.image);
  h.rerender(
    <MarketProductCard
      product={{ ...product, image: 'https://tracker.example/other' }}
      sellerName="Shop"
      variant="list"
      onPress={onPress}
      testID="product"
      autoLoadMedia={false}
    />,
  );
  expect(h.UNSAFE_queryByType(Image)).toBeNull();
});
