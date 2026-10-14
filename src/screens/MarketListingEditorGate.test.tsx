import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import MarketListingEditorScreen from './MarketListingEditorScreen';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { buildListingTemplate, type ListingDraft } from '../utils/marketSellerEvents';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
import type { ShippingOption } from '../utils/marketShipping';
import type { ExploreNavigation, MarketListingEditorRoute } from '../navigation/types';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../hooks/useSellerShop', () => ({ useSellerShop: () => mockShop }));
jest.mock('../hooks/useSellerActions', () => ({
  ...jest.requireActual('../utils/marketSellerRevision'),
  useSellerActions: () => ({
    saveListing: mockSaveListing,
    deleteListing: jest.fn(),
    saveCollection: mockSaveCollection,
    busy: false,
  }),
}));
jest.mock('../hooks/useListingPhotoUpload', () => ({
  useListingPhotoUpload: () => ({ uploading: false, pickAndUpload: jest.fn() }),
}));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../components/BrandedSpinner', () => () => null);
jest.mock('../components/MarketSellerHeader', () => () => null);
jest.mock('../styles/MarketSeller.styles', () => ({
  createMarketSellerStyles: () => new Proxy({}, { get: () => ({}) }),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
// The popup's own publish path is covered in NewCollectionSheet.test.tsx;
// here it just hands a new coordinate back to the editor.
jest.mock('../components/NewCollectionSheet', () => {
  const { TouchableOpacity } = jest.requireActual('react-native');
  return function MockSheet(props: { visible: boolean; onCreated: (c: string) => void }) {
    return props.visible ? (
      <TouchableOpacity
        testID="mock-collection-created"
        onPress={() => props.onCreated(`30405:${'a'.repeat(64)}:prints`)}
      />
    ) : null;
  };
});

const SELLER = 'a'.repeat(64);
const zone = {
  coordinate: `30406:${SELLER}:uk`,
  dTag: 'uk',
  title: 'UK',
  countries: ['GB'],
  baseAmount: 3,
  currency: 'GBP',
} as ShippingOption;
const art = {
  id: 'c1',
  pubkey: SELLER,
  kind: 30405,
  created_at: 1,
  content: '',
  sig: '',
  tags: [
    ['d', 'art'],
    ['title', 'Art'],
  ],
} as Event;
const listing = (tags: string[][]): Event =>
  ({
    id: 'l1',
    pubkey: SELLER,
    kind: 30402,
    created_at: 5,
    content: 'desc',
    sig: '',
    tags: [['d', 'mug'], ['title', 'Mug'], ['price', '2100', 'SATS'], ...tags],
  }) as Event;

const mockShop = {
  pubkey: SELLER,
  defaultCurrency: 'SATS',
  snapshot: {
    shop: null,
    collections: [art],
    listings: [],
    zones: [],
    zoneEvents: new Map(),
  } as SellerSnapshot,
  status: 'ready' as 'ready' | 'error',
  refresh: jest.fn(),
};
const mockSaveListing = jest.fn();
const mockSaveCollection = jest.fn();
const navigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  replace: jest.fn(),
  popTo: jest.fn(),
} as unknown as ExploreNavigation;
const route = (params?: MarketListingEditorRoute['params']) =>
  ({ key: 'editor', name: 'MarketListingEditor', params }) as MarketListingEditorRoute;

const savedDraft = (): ListingDraft => mockSaveListing.mock.calls[0][0];

function fillNewListing(screen: ReturnType<typeof render>) {
  fireEvent.changeText(screen.getByTestId('listing-title-input'), 'Sticker pack');
  fireEvent.changeText(screen.getByTestId('listing-price-input'), '500');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveListing.mockReset().mockResolvedValue({});
  mockShop.status = 'ready';
  mockShop.snapshot = {
    shop: null,
    collections: [art],
    listings: [],
    zones: [],
    zoneEvents: new Map(),
  };
});

describe('shipping gate', () => {
  it('blocks publishing a physical item while the shop has no shipping options', async () => {
    const screen = render(<MarketListingEditorScreen navigation={navigation} route={route()} />);
    expect(screen.getByTestId('shop-shipping-required')).toBeTruthy();
    fillNewListing(screen);
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    expect(mockSaveListing).not.toHaveBeenCalled();
    const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('market.sell.gate.title');
    buttons[0].onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('MarketShopShipping');
  });

  it('opens Shipping Options from the inline notice', () => {
    const screen = render(<MarketListingEditorScreen navigation={navigation} route={route()} />);
    fireEvent.press(screen.getByTestId('shop-shipping-required-add'));
    expect(navigation.navigate).toHaveBeenCalledWith('MarketShopShipping');
  });

  it('publishes a digital item with no shipping', async () => {
    const screen = render(
      <MarketListingEditorScreen navigation={navigation} route={route({ digital: true })} />,
    );
    expect(screen.queryByTestId('shop-shipping-required')).toBeNull();
    fillNewListing(screen);
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(savedDraft()).toMatchObject({ format: 'digital', shipping: [] });
  });

  it('cannot be bypassed by switching a digital item back to physical', async () => {
    const screen = render(
      <MarketListingEditorScreen navigation={navigation} route={route({ digital: true })} />,
    );
    fillNewListing(screen);
    fireEvent.press(screen.getByTestId('listing-format-physical'));
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    expect(mockSaveListing).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('treats an unreachable shop as unknown: retry, never the shipping prompt', async () => {
    mockShop.status = 'error';
    mockShop.snapshot = {
      ...mockShop.snapshot,
      listings: [listing([['type', 'simple', 'physical']])],
    };
    const screen = render(
      <MarketListingEditorScreen navigation={navigation} route={route({ dTag: 'mug' })} />,
    );
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    expect(mockSaveListing).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(mockShop.refresh).toHaveBeenCalled();
  });

  it('publishes a physical item once the shop has a shipping option', async () => {
    mockShop.snapshot = { ...mockShop.snapshot, zones: [zone] };
    const screen = render(<MarketListingEditorScreen navigation={navigation} route={route()} />);
    fillNewListing(screen);
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    expect(savedDraft()).toMatchObject({
      format: 'physical',
      shipping: [{ coordinate: zone.coordinate, extraCost: '' }],
    });
  });
});

describe('collections', () => {
  it('selected collection chips become `a` tags', async () => {
    const screen = render(
      <MarketListingEditorScreen navigation={navigation} route={route({ digital: true })} />,
    );
    fillNewListing(screen);
    fireEvent.press(screen.getByTestId('listing-collection-chip-art'));
    fireEvent.press(screen.getByTestId('listing-new-collection'));
    fireEvent.press(screen.getByTestId('mock-collection-created'));
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    const coordinates = [`30405:${SELLER}:art`, `30405:${SELLER}:prints`];
    expect(savedDraft().collections).toEqual(coordinates);
    const { tags } = buildListingTemplate({ draft: savedDraft(), pubkey: SELLER, nowSeconds: 1 });
    expect(tags.filter((t) => t[0] === 'a')).toEqual(coordinates.map((c) => ['a', c]));
  });

  it('a second tap deselects a collection', async () => {
    const screen = render(
      <MarketListingEditorScreen navigation={navigation} route={route({ digital: true })} />,
    );
    fillNewListing(screen);
    fireEvent.press(screen.getByTestId('listing-collection-chip-art'));
    fireEvent.press(screen.getByTestId('listing-collection-chip-art'));
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    expect(savedDraft().collections).toEqual([]);
  });
});

describe('photos', () => {
  const photos = ['https://b.example/1.jpg', 'https://b.example/2.jpg', 'https://b.example/3.jpg'];

  it('set-as-cover and move write the image tags in the displayed order', async () => {
    mockShop.snapshot = {
      ...mockShop.snapshot,
      zones: [zone],
      listings: [
        listing([
          ['type', 'simple', 'physical'],
          ['shipping_option', zone.coordinate],
          ...photos.map((url, i) => ['image', url, '', String(i)]),
        ]),
      ],
    };
    const screen = render(
      <MarketListingEditorScreen navigation={navigation} route={route({ dTag: 'mug' })} />,
    );
    expect(screen.getByTestId('listing-photo-cover-badge')).toBeTruthy();
    expect(screen.queryByTestId('listing-photo-cover-0')).toBeNull();
    fireEvent.press(screen.getByTestId('listing-photo-cover-2')); // 3,1,2
    fireEvent.press(screen.getByTestId('listing-photo-move-right-1')); // 3,2,1
    await act(async () => fireEvent.press(screen.getByTestId('listing-publish')));
    const order = [photos[2], photos[1], photos[0]];
    expect(savedDraft().images).toEqual(order);
    const { tags } = buildListingTemplate({ draft: savedDraft(), pubkey: SELLER, nowSeconds: 1 });
    expect(tags.filter((t) => t[0] === 'image').map((t) => [t[1], t[3]])).toEqual(
      order.map((url, i) => [url, String(i)]),
    );
  });
});
