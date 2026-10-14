import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import MarketShopCollectionsScreen from './MarketShopCollectionsScreen';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { StaleRevisionError } from '../utils/marketSellerRevision';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
import type { ExploreNavigation } from '../navigation/types';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => key,
}));
jest.mock('../hooks/useSellerShop', () => ({ useSellerShop: () => mockShop }));
jest.mock('../hooks/useSellerActions', () => ({
  ...jest.requireActual('../utils/marketSellerRevision'),
  useSellerActions: () => ({
    saveCollection: mockSaveCollection,
    deleteCollection: mockDeleteCollection,
    deleteLegacyCollection: mockDeleteLegacy,
    busy: false,
  }),
}));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../components/BrandedRefreshControl', () => () => null);
jest.mock('../styles/MarketSeller.styles', () => ({ createMarketSellerStyles: () => ({}) }));
jest.mock('../components/MarketSellerHeader', () => () => null);
jest.mock('lucide-react-native', () => ({ Plus: () => null }));

const SELLER = 'a'.repeat(64);
const collection = (d: string, title: string, id = d): Event =>
  ({
    id,
    pubkey: SELLER,
    kind: 30405,
    created_at: 100,
    content: '',
    sig: '',
    tags: [
      ['d', d],
      ['title', title],
    ],
  }) as Event;
const legacy = {
  ...collection('lightning-piggy-shop', 'Shop', 'legacy'),
  tags: [
    ['d', 'lightning-piggy-shop'],
    ['title', 'Shop'],
    ['currency', 'SATS'],
  ],
} as Event;

const mockShop = {
  snapshot: {
    shop: null,
    collections: [collection('art', 'Art')],
    listings: [],
    zones: [],
    zoneEvents: new Map(),
  } as SellerSnapshot,
  status: 'ready',
  refresh: jest.fn(),
};
const mockSaveCollection = jest.fn();
const mockDeleteCollection = jest.fn();
const mockDeleteLegacy = jest.fn();
const navigation = { goBack: jest.fn() } as unknown as ExploreNavigation;

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveCollection.mockReset().mockResolvedValue({});
  mockDeleteCollection.mockReset().mockResolvedValue(undefined);
  mockDeleteLegacy.mockReset().mockResolvedValue(undefined);
  mockShop.snapshot = {
    shop: null,
    collections: [collection('art', 'Art')],
    listings: [],
    zones: [],
    zoneEvents: new Map(),
  };
});

it('lists collections (never the legacy shop collection)', () => {
  mockShop.snapshot = {
    ...mockShop.snapshot,
    shop: legacy,
    collections: [legacy, collection('art', 'Art')],
  };
  const screen = render(<MarketShopCollectionsScreen navigation={navigation} />);
  expect(screen.getByTestId('collection-art')).toBeTruthy();
  expect(screen.queryByTestId('collection-legacy')).toBeNull();
});

it('creates a collection with a fresh d tag and no base revision', async () => {
  const screen = render(<MarketShopCollectionsScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('collection-create'));
  fireEvent.changeText(screen.getByTestId('collection-title-input'), 'Prints');
  await act(async () => fireEvent.press(screen.getByTestId('collection-save')));
  const [draft, base, options] = mockSaveCollection.mock.calls[0];
  expect(draft).toMatchObject({ title: 'Prints', products: [], shipping: [] });
  expect(draft.dTag).toMatch(/^collection-/);
  expect(base).toBeNull();
  expect(options).toEqual({ force: false });
  expect(screen.queryByTestId('collection-editor')).toBeNull();
});

it('edits against the published revision and asks before overwriting a newer one', async () => {
  const art = mockShop.snapshot.collections![0];
  mockSaveCollection.mockRejectedValueOnce(new StaleRevisionError({ ...art, id: 'newer' }, art));
  const screen = render(<MarketShopCollectionsScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('collection-edit-art'));
  expect(screen.getByTestId('collection-dTag-input').props.editable).toBe(false);
  await act(async () => fireEvent.press(screen.getByTestId('collection-save')));
  expect(mockSaveCollection.mock.calls[0][1]).toBe(art);
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => buttons[1].onPress());
  expect(mockSaveCollection.mock.calls[1][2]).toEqual({ force: true });
});

it('deletes a collection only after confirmation', async () => {
  const screen = render(<MarketShopCollectionsScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('collection-delete-art'));
  expect(mockDeleteCollection).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => buttons[1].onPress());
  expect(mockDeleteCollection).toHaveBeenCalledWith(mockShop.snapshot.collections![0], {
    force: false,
  });
});

it('removes the legacy shop collection only after confirmation', async () => {
  mockShop.snapshot = { ...mockShop.snapshot, shop: legacy };
  const screen = render(<MarketShopCollectionsScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('shop-remove-legacy'));
  expect(mockDeleteLegacy).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => buttons[1].onPress());
  expect(mockDeleteLegacy).toHaveBeenCalledWith(legacy, { force: false });
});

it('reports a failed legacy removal', async () => {
  mockShop.snapshot = { ...mockShop.snapshot, shop: legacy };
  mockDeleteLegacy.mockRejectedValue(new Error('nope'));
  const screen = render(<MarketShopCollectionsScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('shop-remove-legacy'));
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => buttons[1].onPress());
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
});

it('shows the empty state for a loaded shop with no collections', () => {
  mockShop.snapshot = { ...mockShop.snapshot, collections: [] };
  const screen = render(<MarketShopCollectionsScreen navigation={navigation} />);
  expect(screen.getByTestId('shop-collections-empty')).toBeTruthy();
});
