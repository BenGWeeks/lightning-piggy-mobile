import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import MarketListingEditorScreen from './MarketListingEditorScreen';
import { Alert } from '../components/BrandedAlert';
import { StaleRevisionError } from '../utils/marketSellerRevision';
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
  snapshot: { shop: null, listings: [listing], zones: [], zoneEvents: new Map() },
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
