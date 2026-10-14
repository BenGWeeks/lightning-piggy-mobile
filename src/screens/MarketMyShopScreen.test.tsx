import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import MarketMyShopScreen from './MarketMyShopScreen';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
import type { ShopOrder } from '../utils/shopOrders';
import type { ExploreNavigation } from '../navigation/types';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
jest.mock('../hooks/useSellerShop', () => ({ useSellerShop: () => mockShop }));
jest.mock('../hooks/useShopOrders', () => ({ useShopOrders: () => ({ orders: mockOrders }) }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../components/BrandedRefreshControl', () => () => null);
jest.mock('../components/MerchantIdentity', () => () => null);
jest.mock('../components/NostrLoginSheet', () => () => null);
jest.mock('../components/MarketSellerHeader', () => () => null);
jest.mock('../styles/MarketSeller.styles', () => ({ createMarketSellerStyles: () => ({}) }));
jest.mock('../components/SettingsRow', () => {
  const { Text, TouchableOpacity } = jest.requireActual('react-native');
  return function MockRow(props: {
    title: string;
    value: string;
    testID: string;
    subtitleTestID: string;
    onPress: () => void;
  }) {
    return (
      <TouchableOpacity testID={props.testID} onPress={props.onPress}>
        <Text>{props.title}</Text>
        <Text testID={props.subtitleTestID}>{props.value}</Text>
      </TouchableOpacity>
    );
  };
});

const SELLER = 'a'.repeat(64);
const listing = { id: 'l1', pubkey: SELLER, tags: [['d', 'mug']] } as unknown as Event;
const mockShop = {
  pubkey: SELLER,
  canPublish: true,
  defaultCurrency: 'GBP',
  snapshot: { shop: null, listings: [], zones: [], zoneEvents: new Map() } as SellerSnapshot,
  status: 'ready' as 'ready' | 'error' | 'loading',
  refresh: jest.fn(),
};
let mockOrders: ShopOrder[] | null = [];
const navigation = { navigate: jest.fn(), goBack: jest.fn() } as unknown as ExploreNavigation;

beforeEach(() => {
  jest.clearAllMocks();
  mockShop.status = 'ready';
  mockShop.pubkey = SELLER;
  mockShop.snapshot = { shop: null, listings: [], zones: [], zoneEvents: new Map() };
  mockOrders = [];
});

it('replaces "Edit shop" with one card of shop sections and live summaries', () => {
  mockShop.snapshot = {
    ...mockShop.snapshot,
    listings: [listing],
    zones: [{ coordinate: 'z' } as never, { coordinate: 'y' } as never],
  };
  mockOrders = [{ invoiceSent: false } as ShopOrder, { invoiceSent: true } as ShopOrder];
  const screen = render(<MarketMyShopScreen navigation={navigation} />);
  expect(screen.queryByTestId('my-shop-edit')).toBeNull();
  expect(screen.getByTestId('shop-hub-currencies-summary')).toHaveTextContent(
    'market.sell.hub.currencyValue:{"currency":"GBP"}',
  );
  expect(screen.getByTestId('shop-hub-shipping-summary')).toHaveTextContent(
    'market.sell.hub.shippingCount:{"count":2}',
  );
  expect(screen.getByTestId('shop-hub-collections-summary')).toHaveTextContent(
    'market.sell.hub.noneYet',
  );
  expect(screen.getByTestId('shop-hub-listings-summary')).toHaveTextContent(
    'market.sell.hub.listingsCount:{"count":1}',
  );
  expect(screen.getByTestId('shop-hub-orders-summary')).toHaveTextContent(
    'market.sell.hub.ordersNeedInvoice:{"count":1}',
  );
});

it.each([
  ['shop-hub-currencies', 'MarketShopCurrencies'],
  ['shop-hub-shipping', 'MarketShopShipping'],
  ['shop-hub-collections', 'MarketShopCollections'],
  ['shop-hub-listings', 'MarketShopListings'],
  ['shop-hub-orders', 'MarketShopOrders'],
])('%s opens %s', (testID, route) => {
  const screen = render(<MarketMyShopScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId(testID));
  expect(navigation.navigate).toHaveBeenCalledWith(route);
});

it('asks for shipping options before selling when the shop has none', () => {
  const screen = render(<MarketMyShopScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('my-shop-sell-item'));
  expect(navigation.navigate).not.toHaveBeenCalled();
  const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('market.sell.gate.title');
  expect(body).toBe('market.sell.gate.body');
  buttons[0].onPress();
  expect(navigation.navigate).toHaveBeenLastCalledWith('MarketShopShipping');
  buttons[1].onPress();
  expect(navigation.navigate).toHaveBeenLastCalledWith('MarketListingEditor', { digital: true });
  expect(buttons[2].style).toBe('cancel');
});

it('opens the editor straight away when the shop has shipping options', () => {
  mockShop.snapshot = { ...mockShop.snapshot, zones: [{ coordinate: 'z' } as never] };
  const screen = render(<MarketMyShopScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('my-shop-sell-item'));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(navigation.navigate).toHaveBeenCalledWith('MarketListingEditor');
});

it('offers a retry, not the shipping prompt, when the shop could not be loaded', () => {
  mockShop.status = 'error';
  const screen = render(<MarketMyShopScreen navigation={navigation} />);
  expect(screen.getByTestId('shop-hub-shipping-summary')).toHaveTextContent(
    'market.sell.hub.unavailable',
  );
  fireEvent.press(screen.getByTestId('my-shop-sell-item'));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  expect(mockShop.refresh).toHaveBeenCalledTimes(1);
});

it('asks a signed-out visitor to sign in instead of showing the hub', () => {
  mockShop.pubkey = null as unknown as string;
  const screen = render(<MarketMyShopScreen navigation={navigation} />);
  expect(screen.getByTestId('my-shop-sign-in')).toBeTruthy();
  expect(screen.queryByTestId('shop-hub-card')).toBeNull();
});
