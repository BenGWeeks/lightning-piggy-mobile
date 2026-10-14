import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MarketShopOrdersScreen from './MarketShopOrdersScreen';
import type { ShopOrder } from '../utils/shopOrders';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => key,
  useLocale: () => ({
    t: (key: string, p?: Record<string, unknown>) => (p ? `${key}:${JSON.stringify(p)}` : key),
    formatLocale: 'en-GB',
  }),
}));
jest.mock('../hooks/useSellerShop', () => ({
  useSellerShop: () => ({ snapshot: { listings: [] } }),
}));
jest.mock('../hooks/useShopOrders', () => ({
  useShopOrders: () => ({ orders: mockOrders, threads: new Map(), paidKeys: new Set() }),
}));
jest.mock('../hooks/useBuyerProfiles', () => ({ useBuyerProfiles: () => mockProfiles }));
jest.mock('../components/SellerOrderPanel', () => () => null);
jest.mock('../components/MarketSellerHeader', () => () => null);
jest.mock('../components/BrandedSpinner', () => () => null);
jest.mock('lucide-react-native', () => ({ ShoppingBag: () => null }));

const BUYER = 'b'.repeat(64);
let mockOrders: ShopOrder[] | null = [];
let mockProfiles = new Map<string, { name?: string; picture?: string }>();
const navigation = { navigate: jest.fn(), push: jest.fn(), goBack: jest.fn() };

const order: ShopOrder = {
  key: `${BUYER}:o1`,
  orderId: 'o1',
  eventId: 'wrap-1',
  buyer: BUYER,
  createdAt: 1_760_000_000,
  lines: [{ ref: 'x', dTag: 'mug', title: 'Piggy mug', quantity: 2 }],
  amountSats: 2100,
  invoiceSent: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOrders = [];
  mockProfiles = new Map();
});

it('shows "No orders yet" when there are none', () => {
  const screen = render(
    <MarketShopOrdersScreen
      navigation={navigation as never}
      route={{ params: undefined } as never}
    />,
  );
  expect(screen.getByTestId('shop-orders-empty')).toBeTruthy();
});

it('lists an order with buyer, items and amount', () => {
  mockOrders = [order];
  mockProfiles = new Map([[BUYER, { name: 'Alice' }]]);
  const screen = render(
    <MarketShopOrdersScreen
      navigation={navigation as never}
      route={{ params: undefined } as never}
    />,
  );
  expect(screen.getByText('Alice')).toBeTruthy();
  expect(
    screen.getByText('market.sell.orders.line:{"title":"Piggy mug","quantity":2}'),
  ).toBeTruthy();
});

it('opens the shop order detail', () => {
  mockOrders = [order];
  mockProfiles = new Map([[BUYER, { name: 'Alice', picture: 'https://p.example/a.jpg' }]]);
  const screen = render(
    <MarketShopOrdersScreen
      navigation={navigation as never}
      route={{ params: undefined } as never}
    />,
  );
  fireEvent.press(screen.getByTestId('shop-order-o1'));
  expect(navigation.push).toHaveBeenCalledWith('MarketShopOrders', {
    orderId: 'o1',
    buyerPubkey: BUYER,
  });
});
