import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import MarketShopShippingScreen from './MarketShopShippingScreen';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { SellerFetchError, StaleRevisionError } from '../utils/marketSellerRevision';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
import type { ShippingOption } from '../utils/marketShipping';
import type { ExploreNavigation } from '../navigation/types';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../hooks/useSellerShop', () => ({ useSellerShop: () => mockShop }));
jest.mock('../hooks/useSellerActions', () => ({
  ...jest.requireActual('../utils/marketSellerRevision'),
  useSellerActions: () => ({ saveShop: mockSave, busy: mockBusy }),
}));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../styles/MarketSeller.styles', () => ({ createMarketSellerStyles: () => ({}) }));
jest.mock('../components/MarketSellerHeader', () => () => null);
jest.mock('../components/ShippingZoneEditor', () => {
  const { View } = jest.requireActual('react-native');
  return function MockZone({ index }: { index: number }) {
    return <View testID={`zone-${index}`} />;
  };
});
jest.mock('../components/CountryPickerSheet', () => () => null);
jest.mock('../components/BrandedSpinner', () => () => null);
jest.mock('../data/countries', () => ({
  ...jest.requireActual('../data/countries'),
  deviceCountryCode: () => 'GB',
}));
jest.mock('lucide-react-native', () => ({ Plus: () => null }));

const SELLER = 'a'.repeat(64);
const zoneEvent = { id: 'z1', pubkey: SELLER, created_at: 10 } as Event;
const zone: ShippingOption = {
  coordinate: `30406:${SELLER}:uk`,
  dTag: 'uk',
  title: 'UK',
  countries: ['GB'],
  baseAmount: 3,
  currency: 'GBP',
  createdAt: 10,
} as ShippingOption;

const mockShop = {
  snapshot: {
    shop: null,
    listings: [],
    zones: [zone],
    zoneEvents: new Map([[zone.coordinate, zoneEvent]]),
  } as SellerSnapshot,
  status: 'ready' as 'ready' | 'error' | 'loading',
  refresh: jest.fn(),
  defaultCurrency: 'SATS',
};
const mockSave = jest.fn();
let mockBusy = false;
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as unknown as ExploreNavigation;

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockReset().mockResolvedValue(undefined);
  mockBusy = false;
  mockShop.status = 'ready';
  mockShop.snapshot = {
    shop: null,
    listings: [],
    zones: [zone],
    zoneEvents: new Map([[zone.coordinate, zoneEvent]]),
  };
});

it('loads the published options and saves them against the revisions it loaded', async () => {
  const screen = render(<MarketShopShippingScreen navigation={navigation} />);
  expect(screen.getByTestId('zone-0')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('shop-shipping-save')));
  expect(mockSave).toHaveBeenCalledWith(
    { currency: 'SATS' },
    [{ dTag: 'uk', name: 'UK', countries: ['GB'], cost: '3', currency: 'GBP' }],
    {
      shop: null,
      zoneCoordinates: [zone.coordinate],
      zoneEvents: new Map([[zone.coordinate, zoneEvent]]),
    },
    { force: false },
  );
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
});

it('adds a new option in the shop currency for the device country', async () => {
  const screen = render(<MarketShopShippingScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('shop-add-zone'));
  expect(screen.getByTestId('zone-1')).toBeTruthy();
});

it('never offers a blank form when the fetch failed (unknown is not "none")', () => {
  mockShop.status = 'error';
  mockShop.snapshot = { shop: null, listings: [], zones: [], zoneEvents: new Map() };
  const screen = render(<MarketShopShippingScreen navigation={navigation} />);
  expect(screen.queryByTestId('shop-shipping-save')).toBeNull();
  fireEvent.press(screen.getByTestId('shop-shipping-retry'));
  expect(mockShop.refresh).toHaveBeenCalledTimes(1);
});

it('shows the empty state for a loaded shop without options', () => {
  mockShop.snapshot = { shop: null, listings: [], zones: [], zoneEvents: new Map() };
  const screen = render(<MarketShopShippingScreen navigation={navigation} />);
  expect(screen.getByTestId('shop-shipping-empty')).toBeTruthy();
});

it.each([new Error('Publish failed'), new SellerFetchError('Offline')])(
  'stays on the form after a failed save: %s',
  async (error) => {
    mockSave.mockRejectedValue(error);
    const screen = render(<MarketShopShippingScreen navigation={navigation} />);
    await act(async () => fireEvent.press(screen.getByTestId('shop-shipping-save')));
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  },
);

it('asks before overwriting a newer revision, then saves with force', async () => {
  mockSave.mockRejectedValueOnce(new StaleRevisionError({ ...zoneEvent, id: 'newer' }, zoneEvent));
  const screen = render(<MarketShopShippingScreen navigation={navigation} />);
  await act(async () => fireEvent.press(screen.getByTestId('shop-shipping-save')));
  expect(navigation.goBack).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => buttons[1].onPress());
  expect(mockSave.mock.calls[1][3]).toEqual({ force: true });
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

it('reloads instead of saving when options appeared that the form never saw', async () => {
  mockSave.mockRejectedValueOnce(new StaleRevisionError(zoneEvent, null));
  const screen = render(<MarketShopShippingScreen navigation={navigation} />);
  await act(async () => fireEvent.press(screen.getByTestId('shop-shipping-save')));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockShop.refresh).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledTimes(1);
});

it('disables saving while a save is in flight', () => {
  mockBusy = true;
  const screen = render(<MarketShopShippingScreen navigation={navigation} />);
  expect(screen.getByTestId('shop-shipping-save')).toBeDisabled();
});
