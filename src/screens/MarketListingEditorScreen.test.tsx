import { buildShopTemplate } from '../utils/marketSellerTestFixtures';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import MarketListingEditorScreen from './MarketListingEditorScreen';
import { Alert } from '../components/BrandedAlert';
import { StaleRevisionError } from '../utils/marketSellerRevision';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
import { buildListingTemplate } from '../utils/marketSellerEvents';
import type { ExploreNavigation, MarketListingEditorRoute } from '../navigation/types';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../hooks/useSellerShop', () => ({ useSellerShop: () => mockShop }));
jest.mock('../hooks/useSellerActions', () => ({
  ...jest.requireActual('../utils/marketSellerRevision'),
  useSellerActions: () => ({ saveListing: mockSave, deleteListing: jest.fn(), busy: false }),
}));
jest.mock('../hooks/useListingPhotoUpload', () => ({ useListingPhotoUpload: () => ({}) }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../styles/MarketSeller.styles', () => ({ createMarketSellerStyles: () => ({}) }));
jest.mock('../components/MarketSellerHeader', () => () => null);
jest.mock('../components/SellerCurrencyChips', () => () => null);
jest.mock('../components/ListingPhotosField', () => () => null);
jest.mock('../components/ListingShippingPicker', () => () => null);
jest.mock('lucide-react-native', () => ({ Eye: () => null, Trash2: () => null }));

const key = new Uint8Array(32).fill(7);
const pubkey = getPublicKey(key);
const listing = finalizeEvent(
  {
    ...buildListingTemplate({
      draft: {
        dTag: 'book',
        title: 'Book',
        description: 'Book',
        images: [],
        price: '21',
        currency: 'SAT',
        quantity: '1',
        categories: [],
        shipping: [],
      },
      pubkey,
      nowSeconds: 100,
    }),
    created_at: 100,
  },
  key,
);
const mockShop = {
  pubkey,
  snapshot: { shop: null, listings: [listing], zones: [], zoneEvents: new Map() } as SellerSnapshot,
  status: 'ready',
  refresh: jest.fn(),
};
const mockSave = jest.fn();

it('retains the deletion conflict after Cancel when the shared snapshot removed the listing', async () => {
  mockSave.mockRejectedValue(new StaleRevisionError(null, listing));
  const navigation = { goBack: jest.fn() } as unknown as ExploreNavigation;
  const route = { params: { dTag: 'book' } } as MarketListingEditorRoute;
  const screen = render(<MarketListingEditorScreen navigation={navigation} route={route} />);
  fireEvent.changeText(screen.getByTestId('listing-title-input'), 'Edited book');
  mockShop.snapshot = { ...mockShop.snapshot, listings: [] };
  screen.rerender(<MarketListingEditorScreen navigation={navigation} route={route} />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('listing-publish'));
  });
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  act(() => buttons[0].onPress());
  await act(async () => {
    fireEvent.press(screen.getByTestId('listing-publish'));
  });
  expect(mockSave).toHaveBeenCalledTimes(2);
  expect(mockSave.mock.calls[1][1]).toBe(listing);
  expect(mockSave.mock.calls[1][2]).toEqual({ force: false });
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  expect(navigation.goBack).not.toHaveBeenCalled();
});

describe('listing creation after shop setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockReset().mockResolvedValue(undefined);
    mockShop.snapshot = {
      shop: finalizeEvent(
        {
          ...buildShopTemplate({
            shop: { name: 'My shop', description: '', currency: 'SATS' },
            pubkey,
            productCoordinates: [],
            zoneCoordinates: [],
          }),
          created_at: 100,
        },
        key,
      ),
      listings: [],
      zones: [],
      zoneEvents: new Map(),
    };
  });

  const navigation = { goBack: jest.fn(), popTo: jest.fn() } as unknown as ExploreNavigation;
  const renderDraft = (returnToMyShop?: boolean) => {
    const route = { params: { returnToMyShop } } as MarketListingEditorRoute;
    const screen = render(<MarketListingEditorScreen navigation={navigation} route={route} />);
    fireEvent.changeText(screen.getByTestId('listing-title-input'), 'First item');
    fireEvent.changeText(screen.getByTestId('listing-description-input'), 'An item to sell');
    fireEvent.changeText(screen.getByTestId('listing-price-input'), '21');
    return screen;
  };

  it('returns to My shop only after publishing the first listing succeeds', async () => {
    let finish!: () => void;
    mockSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const screen = renderDraft(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('listing-publish'));
    });
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'First item' }), null, {
      force: false,
    });
    expect(navigation.popTo).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(navigation.popTo).toHaveBeenCalledWith('MarketMyShop');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('stays in the editor if publishing fails', async () => {
    mockSave.mockRejectedValue(new Error('Offline'));
    const screen = renderDraft(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('listing-publish'));
    });
    expect(navigation.popTo).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('keeps back navigation for ordinary listing creation', async () => {
    const screen = renderDraft();
    await act(async () => {
      fireEvent.press(screen.getByTestId('listing-publish'));
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.popTo).not.toHaveBeenCalled();
  });
});
