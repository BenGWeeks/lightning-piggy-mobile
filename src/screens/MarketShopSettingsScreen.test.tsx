import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import MarketShopSettingsScreen from './MarketShopSettingsScreen';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { SellerFetchError, StaleRevisionError } from '../utils/marketSellerRevision';
import { buildShopTemplate } from '../utils/marketSellerEvents';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
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
jest.mock('../components/SellerCurrencyChips', () => () => null);
jest.mock('../components/ShippingZoneEditor', () => () => null);
jest.mock('../components/CountryPickerSheet', () => () => null);
jest.mock('../data/countries', () => ({ deviceCountryCode: () => null }));
jest.mock('lucide-react-native', () => ({ Plus: () => null }));

const shop = {
  ...buildShopTemplate({
    shop: { name: 'My shop', description: '', currency: 'SATS' },
    pubkey: 'seller',
    productCoordinates: [],
    zoneCoordinates: [],
  }),
  id: 'shop',
  pubkey: 'seller',
  created_at: 100,
  sig: '',
} as Event;
const mockShop = {
  snapshot: { shop, listings: [], zones: [], zoneEvents: new Map() } as SellerSnapshot,
  status: 'ready',
  refresh: jest.fn(),
};
const mockSave = jest.fn();
let mockBusy = false;
const navigation = {
  goBack: jest.fn(),
  replace: jest.fn(),
} as unknown as ExploreNavigation;

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockReset().mockResolvedValue(undefined);
  mockBusy = false;
  mockShop.snapshot = { shop, listings: [], zones: [], zoneEvents: new Map() };
  mockShop.status = 'ready';
});

it.each([
  ['first-time setup', null, []],
  ['shop without listings', shop, []],
  ['listings without a shop', null, [shop]],
] as const)('offers both setup actions for %s', (_label, existing, listings) => {
  mockShop.snapshot = { ...mockShop.snapshot, shop: existing, listings: [...listings] };
  const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
  expect(screen.getByTestId('shop-save-and-add-item')).toHaveTextContent(
    'market.sell.shop.saveAndAddFirstItem',
  );
  expect(screen.getByTestId('shop-save-for-now')).toHaveTextContent('market.sell.shop.saveForNow');
  expect(screen.queryByTestId('shop-save')).toBeNull();
});

it('keeps Save shop for an existing shop with listings', async () => {
  mockShop.snapshot.listings = [shop];
  const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
  expect(screen.queryByTestId('shop-save-and-add-item')).toBeNull();
  expect(screen.queryByTestId('shop-save-for-now')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('shop-save')));
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(navigation.replace).not.toHaveBeenCalled();
});

it('opens the Explore editor in create mode only after saving succeeds', async () => {
  let finish!: () => void;
  mockSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
  await act(async () => fireEvent.press(screen.getByTestId('shop-save-and-add-item')));
  expect(mockSave).toHaveBeenCalledWith(
    { name: 'My shop', description: '', currency: 'SATS' },
    [],
    { shop, zoneCoordinates: [], zoneEvents: new Map() },
    { force: false },
  );
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(navigation.goBack).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(navigation.replace).toHaveBeenCalledWith('MarketListingEditor', { returnToMyShop: true });
  expect(navigation.goBack).not.toHaveBeenCalled();
});

it('Save for now saves and keeps the existing back navigation', async () => {
  const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
  await act(async () => fireEvent.press(screen.getByTestId('shop-save-for-now')));
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(navigation.replace).not.toHaveBeenCalled();
});

it.each([new Error('Publish failed'), new SellerFetchError('Offline')])(
  'stays on the form after a failed save: %s',
  async (error) => {
    mockSave.mockRejectedValue(error);
    const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
    await act(async () => fireEvent.press(screen.getByTestId('shop-save-and-add-item')));
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  },
);

it('preserves the add-item destination through a confirmed revision overwrite', async () => {
  mockSave.mockRejectedValueOnce(new StaleRevisionError({ ...shop, id: 'newer' }, shop));
  const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
  await act(async () => fireEvent.press(screen.getByTestId('shop-save-and-add-item')));
  expect(navigation.replace).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => buttons[1].onPress());
  expect(mockSave.mock.calls[1][3]).toEqual({ force: true });
  expect(navigation.replace).toHaveBeenCalledWith('MarketListingEditor', { returnToMyShop: true });
});

it('does not save or navigate when validation fails', async () => {
  const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
  fireEvent.changeText(screen.getByTestId('shop-name-input'), '');
  await act(async () => fireEvent.press(screen.getByTestId('shop-save-and-add-item')));
  expect(mockSave).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it('disables both setup actions while saving', () => {
  mockBusy = true;
  const screen = render(<MarketShopSettingsScreen navigation={navigation} />);
  expect(screen.getByTestId('shop-save-and-add-item')).toBeDisabled();
  expect(screen.getByTestId('shop-save-for-now')).toBeDisabled();
});
